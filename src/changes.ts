// The uncommitted-changes panel's actions: each runs git in a task, then asks
// for the shown repo's status (and so its history) to be read again.

import type { AsyncContext, Context } from "gpui-kit";
import { TextareaState } from "gpui-base";
import { exec, readTextFile, writeTextFile } from "herdr";
import {
  askConfirm, changeSource, chooseBlock, closeSide, startResolving, emptyChanges, forRepoChanges, hunkPick, openSide, picks, setAmend, setBusy, togglePick,
  withResult, withStageDiff, type ChangesView,
} from "./core/changesView.ts";
import type { Git, Target } from "./core/git/runner.ts";
import type { RepoStatus } from "./core/git/status.ts";
import type { Pick } from "./core/stage.ts";
import { remember } from "./core/stage.ts";
import {
  applyPicks, commitChanges, takeSide, discardFiles, loadStageDiff, readLastMessage, splitChanges, stageFiles, unstageFiles,
  type ChangeFile, type Changes, type Files,
} from "./core/staging.ts";
import { allChosen, parseConflicts, resolveFile } from "./core/conflict.ts";
import { pickWriter, suggestWithAi } from "./core/aiMessage.ts";
import { draftMessage, followDraft } from "./core/draft.ts";
import { excludeLocally, readExcluded, unexcludeLocally } from "./core/exclude.ts";
import { agentNote, type RepoAgent } from "./core/repoAgents.ts";
import type { ViewerRequest } from "./core/panel.ts";
import { undoLastCommit } from "./core/undo.ts";
import type { ChangesActions, ChangesParts } from "./ui/changes.ts";

export const files: Files = {
  read: (path) => readTextFile(path),
  write: (path, text, expected) => writeTextFile(path, text, expected),
  remove: (path) => exec("rm", ["-f", "--", path]),
};

export interface ChangesHost {
  git: Git;
  /** The shown repo, when its status was read and it is trusted. */
  target: () => Target | null;
  status: () => RepoStatus | null;
  /** Reads the shown repo's status again after a change. */
  changed: (cx: AsyncContext) => Promise<void>;
  /** The coding agents whose terminal is in the shown repo. */
  agents: () => readonly RepoAgent[];
  /** Herdr keys of the coding agents installed here, most picked first. */
  installedAgents: () => Promise<readonly string[]>;
  /** Shows a request in the viewer tab in the main area. */
  openViewer: (request: ViewerRequest) => void;
}

export class ChangesPanel {
  view: ChangesView = emptyChanges(null);
  message!: TextareaState;
  /** Recent commit messages, newest first. */
  recent: string[] = [];
  /** The last message drafted from the staged files, to tell it from one the person wrote. */
  drafted = "";
  /** A commit was just made here and can still be undone (not an amend, not pushed). */
  undoable = false;
  /** The patterns in the shown repo's .git/info/exclude. */
  ignored: string[] = [];
  /** Claude Code is writing a message. */
  suggesting = false;

  private readonly host: ChangesHost;

  constructor(host: ChangesHost) {
    this.host = host;
  }

  /** Needs a live host call: from init only. */
  init(): void {
    this.message = TextareaState.new({ placeholder: "Commit message", rows: 3 });
  }

  forRepo(repo: string | null): void {
    if (repo !== this.view.repo) {
      this.undoable = false;
      this.ignored = [];
    }
    this.view = forRepoChanges(this.view, repo);
  }

  async readIgnored(cx: AsyncContext): Promise<void> {
    const target = this.host.target();
    if (!target) return;
    this.ignored = await readExcluded(this.host.git, files, target);
    cx.notify();
  }

  /** Edits the exclude file, then lists it again so the Ignored section follows. */
  private editIgnored(cx: Context, edit: (git: Git, target: Target) => Promise<string | null>): void {
    this.act(cx, async (git, target) => {
      const error = await edit(git, target);
      this.ignored = await readExcluded(git, files, target);
      return error;
    });
  }

  /** The person's coding agent writes the message; a box edited meanwhile is left alone. */
  suggest(cx: Context): void {
    const target = this.host.target();
    if (!target || this.suggesting) return;
    this.suggesting = true;
    const before = this.message.value();
    cx.notify();
    cx.spawn(async (cx) => {
      const writer = pickWriter(this.host.agents().map((a) => a.key), await this.host.installedAgents());
      const result = await suggestWithAi(this.host.git, exec, target, writer);
      this.suggesting = false;
      const untouched = this.message.value() === before;
      if ("message" in result) {
        if (untouched) this.message.set_value(result.message);
      } else {
        this.view = { ...this.view, error: result.error };
        // Still something to start from: the plain draft from the file names.
        const draft = draftMessage(this.changes().staged);
        if (untouched && before.trim() === "" && draft !== "") {
          this.drafted = draft;
          this.message.set_value(draft);
        }
      }
      cx.notify();
    });
  }

  changes(): Changes {
    return splitChanges(this.host.status()?.entries ?? []);
  }

  /** After the status changes: the draft follows the staged files, unless the person wrote their own. */
  syncDraft(): void {
    const draft = draftMessage(this.changes().staged);
    const next = followDraft(this.message.value(), this.drafted, draft, this.view.amend);
    this.drafted = draft;
    if (next !== null) this.message.set_value(next);
  }

  parts(): ChangesParts {
    return {
      view: this.view,
      changes: this.changes(),
      message: this.message,
      local: this.host.target()?.on === null,
      agentNote: agentNote(this.host.agents()),
      undoable: this.undoable,
      ignored: this.ignored,
      suggesting: this.suggesting,
      fresh: new Set(),
    };
  }

  /** Runs one git action, then re-reads the status and the open diff. */
  act(cx: Context, action: (git: Git, target: Target) => Promise<string | null>, after?: () => void): void {
    const target = this.host.target();
    if (!target || this.view.busy) return;
    this.view = setBusy(askConfirm(this.view, null), true);
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await action(this.host.git, target);
      this.view = withResult(this.view, error);
      if (error === null) after?.();
      await this.host.changed(cx);
      await this.readDiff(cx);
      cx.notify();
    });
  }

  async readDiff(cx: AsyncContext): Promise<void> {
    const open = this.view.open;
    const target = this.host.target();
    if (!open || !target) return;
    const diff = open.untracked
      ? { raw: "", rows: [{ kind: "note" as const, old: null, new: null, text: "New file: stage it to commit it" }] }
      : await loadStageDiff(this.host.git, target, open.path, open.staged);
    this.view = withStageDiff(this.view, open.path, open.staged, diff);
    cx.notify();
  }

  applyPicks(cx: Context, chosen: Pick[]): void {
    const raw = this.view.diff?.raw ?? "";
    const reverse = this.view.open?.staged ?? false;
    this.act(cx, (git, target) => applyPicks(git, files, target, raw, chosen, reverse));
  }

  actions(): ChangesActions {
    const hasHead = () => this.host.status()?.oid !== null;
    return {
      open: (file: ChangeFile, staged: boolean) => {
        const target = this.host.target();
        if (target) this.host.openViewer({ view: "diff", repo: target.cwd, on: target.on, source: changeSource(file, staged) });
      },
      lines: (file: ChangeFile, staged: boolean, cx: Context) => {
        this.view = openSide(this.view, file.path, staged, file.untracked && !staged);
        cx.spawn((cx) => this.readDiff(cx));
        cx.notify();
      },
      closeDiff: (cx) => {
        this.view = closeSide(this.view);
        cx.notify();
      },
      stage: (paths, cx) => this.act(cx, (git, target) => stageFiles(git, target, paths)),
      unstage: (paths, cx) => this.act(cx, (git, target) => unstageFiles(git, target, paths, hasHead())),
      discard: (file, cx) => {
        // Discarding can't be undone: the first click asks, the second does it.
        const key = `discard:${file.path}`;
        if (this.view.confirm !== key) {
          this.view = askConfirm(this.view, key);
          cx.notify();
          return;
        }
        this.act(cx, (git, target) => discardFiles(git, target, [file]));
      },
      resolve: (file, cx) => {
        const target = this.host.target();
        if (!target) return;
        cx.spawn(async (cx) => {
          const text = await readTextFile(`${target.cwd}/${file.path}`);
          this.view = text === null ? withResult(this.view, `Can't read ${file.path}`) : startResolving(this.view, { path: file.path, original: text, segments: parseConflicts(text) });
          cx.notify();
        });
      },
      chooseBlock: (i, choice, cx) => {
        this.view = chooseBlock(this.view, i, choice);
        cx.notify();
      },
      closeResolve: (cx) => {
        this.view = startResolving(this.view, null);
        cx.notify();
      },
      saveResolved: (cx) => {
        const r = this.view.resolving;
        if (!r || !allChosen(r.segments)) return;
        this.act(cx, (git, target) => resolveFile(git, files, target, r.path, r.original, r.segments), () => {
          this.view = startResolving(this.view, null);
        });
      },
      takeSide: (file, side, cx) => this.act(cx, (git, target) => takeSide(git, target, [file.path], side)),
      diffClick: (row, cx) => {
        const hunk = hunkPick(this.view, row);
        if (hunk) return this.applyPicks(cx, [hunk]);
        this.view = togglePick(this.view, row);
        cx.notify();
      },
      applyPicked: (cx) => this.applyPicks(cx, picks(this.view)),
      toggleAmend: (cx) => {
        const amend = !this.view.amend;
        this.view = setAmend(this.view, amend);
        const target = this.host.target();
        // Amending starts from the last message, unless one is already written.
        if (amend && target && this.message.value().trim() === "") {
          cx.spawn(async (cx) => {
            const last = await readLastMessage(this.host.git, target);
            if (this.view.amend && this.message.value().trim() === "") this.message.set_value(last);
            cx.notify();
          });
        }
        cx.notify();
      },
      suggest: (cx) => this.suggest(cx),
      commit: (cx) => {
        // While an agent is still working, the first click asks: its changes may be half-made.
        if (agentNote(this.host.agents())?.kind === "working" && this.view.confirm !== "commit") {
          this.view = askConfirm(this.view, "commit");
          cx.notify();
          return;
        }
        const text = this.message.value();
        const amend = this.view.amend;
        this.act(
          cx,
          (git, target) => commitChanges(git, target, text, amend),
          () => {
            this.recent = remember(this.recent, text);
            this.message.set_value("");
            this.view = setAmend(this.view, false);
            this.undoable = !amend;
          },
        );
      },
      undo: (cx) => this.act(cx, undoLastCommit, () => {
        this.undoable = false;
      }),
      ignore: (file, cx) => this.editIgnored(cx, (git, target) => excludeLocally(git, files, target, file.path)),
      unignore: (line, cx) => this.editIgnored(cx, (git, target) => unexcludeLocally(git, files, target, line)),
    };
  }
}
