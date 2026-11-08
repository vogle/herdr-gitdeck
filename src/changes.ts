// The uncommitted-changes panel's actions: each runs git in a task, then asks
// for the shown repo's status (and so its history) to be read again.

import type { AsyncContext, Context } from "gpui-kit";
import { TextareaState } from "gpui-base";
import { exec, readTextFile, writeTextFile } from "herdr";
import {
  askConfirm, closeSide, emptyChanges, forRepoChanges, hunkPick, openSide, picks, setAmend, setBusy, togglePick,
  withResult, withStageDiff, type ChangesView,
} from "./core/changesView.ts";
import type { Git, Target } from "./core/git/runner.ts";
import type { RepoStatus } from "./core/git/status.ts";
import type { Pick } from "./core/stage.ts";
import { remember } from "./core/stage.ts";
import {
  applyPicks, commitChanges, discardFiles, loadStageDiff, readLastMessage, splitChanges, stageFiles, unstageFiles,
  type ChangeFile, type Changes, type Files,
} from "./core/staging.ts";
import type { ChangesActions, ChangesParts } from "./ui/changes.ts";

const files: Files = {
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
}

export class ChangesPanel {
  view: ChangesView = emptyChanges(null);
  message!: TextareaState;
  /** Recent commit messages, newest first. */
  recent: string[] = [];

  private readonly host: ChangesHost;

  constructor(host: ChangesHost) {
    this.host = host;
  }

  /** Needs a live host call: from init only. */
  init(): void {
    this.message = TextareaState.new({ placeholder: "Commit message", rows: 3 });
  }

  forRepo(repo: string | null): void {
    this.view = forRepoChanges(this.view, repo);
  }

  changes(): Changes {
    return splitChanges(this.host.status()?.entries ?? []);
  }

  parts(): ChangesParts {
    return { view: this.view, changes: this.changes(), message: this.message, local: this.host.target()?.on === null };
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
      open: (file: ChangeFile, staged: boolean, cx: Context) => {
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
      commit: (cx) => {
        const text = this.message.value();
        const amend = this.view.amend;
        this.act(
          cx,
          (git, target) => commitChanges(git, target, text, amend),
          () => {
            this.recent = remember(this.recent, text);
            this.message.set_value("");
            this.view = setAmend(this.view, false);
          },
        );
      },
      close: (cx) => {
        this.view = closeSide(askConfirm(this.view, null));
        cx.notify();
      },
    };
  }
}
