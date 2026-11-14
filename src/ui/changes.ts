// The uncommitted changes, for watching what an agent is changing: the file
// lists (changeFiles.ts) and a commit box folded away because agents commit.
// Diffs, and staging a file by hunk or line, open in the viewer tab.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Textarea, type InputState, type TextareaState } from "gpui-base";
import type { ChangesView, Resolving } from "../core/changesView.ts";
import { allChosen, type Choice } from "../core/conflict.ts";
import type { AgentNote } from "../core/repoAgents.ts";
import type { ChangeCounts } from "../core/lineCounts.ts";
import type { ChangeFile, Changes } from "../core/staging.ts";
import { monoFont, textButton, type Palette } from "./style.ts";
import { fileLists, filesBar } from "./changeFiles.ts";

export interface ChangesActions {
  /** Shows one side of a file's diff in the viewer tab. */
  open: (file: ChangeFile, staged: boolean, cx: Context) => void;
  /** Opens one side of a file in the viewer tab, to stage or unstage single hunks and lines. */
  lines: (file: ChangeFile, staged: boolean, cx: Context) => void;
  stage: (paths: string[], cx: Context) => void;
  unstage: (paths: string[], cx: Context) => void;
  discard: (file: ChangeFile, cx: Context) => void;
  /** A conflicted file: keep one side whole, and stage it. */
  takeSide: (file: ChangeFile, side: "ours" | "theirs", cx: Context) => void;
  /** Resolve a conflicted file block by block. */
  resolve: (file: ChangeFile, cx: Context) => void;
  chooseBlock: (index: number, choice: Choice, cx: Context) => void;
  saveResolved: (cx: Context) => void;
  closeResolve: (cx: Context) => void;
  toggleAmend: (cx: Context) => void;
  /** Claude Code writes a message from the staged diff into the box. */
  suggest: (cx: Context) => void;
  commit: (cx: Context) => void;
  /** Moves HEAD back one commit; its changes stay staged. */
  undo: (cx: Context) => void;
  /** Lists an untracked file in .git/info/exclude so it stops showing. */
  ignore: (file: ChangeFile, cx: Context) => void;
  /** Takes a pattern back out of .git/info/exclude, so its files show again. */
  unignore: (line: string, cx: Context) => void;
  /** Opens or folds the commit box. */
  toggleCompose: (cx: Context) => void;
  /** The pointer entered or left a file row. */
  hover: (row: string, on: boolean, cx: Context) => void;
  /** Switches to the Review tab. */
  review: (cx: Context) => void;
  /** Opens or folds a folder in the file lists. */
  toggleFolder: (key: string, cx: Context) => void;
  /** Replaces the set of folders turned from their default (Expand / Collapse all). */
  setFlipped: (next: ReadonlySet<string>, cx: Context) => void;
  /** Lists files flat (true) or as a folder tree. */
  setView: (list: boolean, cx: Context) => void;
  /** Opens or folds a section: staged, changes, ignored, conflicts. */
  toggleSection: (id: string, cx: Context) => void;
  /** Throws away a folder's changes (a wholly new folder: deletes it); asks first. */
  discardFolder: (folder: string, isNew: boolean, files: readonly ChangeFile[], cx: Context) => void;
  /** Lists a wholly new folder in .git/info/exclude so it stops showing. */
  ignoreFolder: (folder: string, cx: Context) => void;
}

export interface ChangesParts {
  view: ChangesView;
  changes: Changes;
  message: TextareaState;
  /** Partial staging writes a patch file: this machine only. */
  local: boolean;
  /** What a coding agent working in this repo means for the commit, if anything. */
  agentNote: AgentNote | null;
  /** The last commit was made here and can be undone. */
  undoable: boolean;
  /** The patterns in .git/info/exclude (this machine's repos only). */
  ignored: readonly string[];
  /** Claude Code is writing a message. */
  suggesting: boolean;
  /** Files changed since the person last looked (a dot marks them). */
  fresh: ReadonlySet<string>;
  /** The commit box is open. */
  composing: boolean;
  /** The file row under the pointer. */
  hovered: string | null;
  /** Folders turned from their default: open, but a wholly new one folded (see fileGroups.ts). */
  flipped: ReadonlySet<string>;
  /** Wholly new folders, each shown as one row until opened. */
  newFolders: readonly string[];
  /** The file filter's text box. */
  filter: InputState;
  /** Files listed flat, not as a folder tree. */
  list: boolean;
  /** Sections folded away. */
  closed: ReadonlySet<string>;
  /** Lines each file adds and removes, per side. */
  counts: ChangeCounts;
}

/**
 * An agent that finished: the one agent state that asks the watcher to act here.
 * Working and waiting show in the header; working also warns in the commit box.
 */
function doneBanner(note: AgentNote, p: Palette, a: ChangesActions): Element {
  return h_flex()
    .px(10)
    .py(4)
    .gap(6)
    .flex_shrink_0()
    .items_center()
    .text_xs()
    .bg(p.raised)
    .text_color(p.added)
    .child("✅")
    .child(div().min_w_0().flex_1().truncate().child(note.text))
    .child(textButton("note-review", "Review →", p, a.review));
}

function commitLabel(parts: ChangesParts): string {
  const { view } = parts;
  if (view.busy) return "Working…";
  if (view.confirm === "commit") return "Commit anyway?";
  return view.amend ? "Amend" : `Commit ${parts.changes.staged.length}`;
}

/** Agents commit, so the box is folded to one line until the person wants to commit by hand. */
function commitBox(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const { view } = parts;
  const staged = parts.changes.staged.length;
  const bar = h_flex()
    .h(28)
    .px(4)
    .gap(6)
    .items_center()
    .child(textButton("compose", parts.composing ? "▾ Commit manually" : "▸ Commit manually…", p, a.toggleCompose))
    .child(div().flex_1())
    .when(!parts.composing && staged > 0, (el) => el.child(div().text_xs().text_color(p.dim).child(`${staged} staged`)))
    .when(parts.undoable && !view.busy, (el) => el.child(textButton("undo-commit", "↶ Undo commit", p, a.undo)));
  const box = v_flex().flex_shrink_0().px(4).pb(4).border_t_1().border_color(p.border).child(bar);
  if (!parts.composing) return box;
  const working = parts.agentNote?.kind === "working" ? parts.agentNote : null;
  const canCommit = (staged > 0 || view.amend) && !view.busy;
  return box.child(
    v_flex()
      .px(4)
      .gap(6)
      .when(working !== null, (el) => el.child(div().text_xs().text_color(p.changed).child(`⏳ ${working?.text ?? ""}`)))
      .child(div().rounded(4).border_1().border_color(p.border).bg(p.chrome).px(6).py(4).child(Textarea.new(parts.message).w_full().text_sm()))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(textButton("suggest", parts.suggesting ? "✨ Writing…" : "✨ Suggest", p, a.suggest, parts.suggesting, parts.suggesting || staged > 0))
          .child(textButton("amend", view.amend ? "☑ Amend last commit" : "☐ Amend last commit", p, a.toggleAmend, view.amend))
          .child(div().flex_1())
          .child(textButton("commit", commitLabel(parts), p, a.commit, canCommit, canCommit)),
      ),
  );
}

function side(label: string, lines: readonly string[], color: Palette["added"], p: Palette): Element {
  return v_flex()
    .flex_1()
    .min_w_0()
    .child(div().text_color(p.dim).child(label))
    .children(lines.slice(0, 40).map((l) => div().truncate().text_color(color).child(l === "" ? " " : l)))
    .when(lines.length > 40, (el) => el.child(div().text_color(p.dim).child(`… ${lines.length - 40} more lines`)));
}

/** Each conflict side by side, with Ours / Theirs / Both. */
function resolvePane(r: Resolving, p: Palette, a: ChangesActions): Element {
  let n = -1;
  const blocks = r.segments.flatMap((s) => {
    if (s.kind !== "conflict") return [];
    n += 1;
    const i = n;
    const pick = (c: Choice, label: string) => textButton(`rb:${i}:${c}`, label, p, (cx) => a.chooseBlock(i, c, cx), s.choice === c);
    return [
      v_flex()
        .p(6)
        .gap(4)
        .border_b_1()
        .border_color(p.border)
        .child(h_flex().gap(4).items_center().child(div().flex_1().text_color(p.muted).child(`Conflict ${i + 1}`)).child(pick("ours", "Ours")).child(pick("theirs", "Theirs")).child(pick("both", "Both")))
        .child(h_flex().gap(8).items_start().child(side(`ours (${s.oursLabel || "HEAD"})`, s.ours, p.removed, p)).child(side(`theirs (${s.theirsLabel || "incoming"})`, s.theirs, p.added, p))),
    ];
  });
  const total = n + 1;
  const done = allChosen(r.segments);
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(
      h_flex()
        .h(28)
        .px(8)
        .gap(6)
        .items_center()
        .flex_shrink_0()
        .border_b_1()
        .border_color(p.border)
        .child(textButton("resolve-back", "← Files", p, a.closeResolve))
        .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.muted).child(`${r.path}: ${total} conflict${total === 1 ? "" : "s"}`))
        .child(textButton("resolve-save", "Save and mark resolved", p, a.saveResolved, done)),
    )
    .child(
      total === 0
        ? div().p(12).text_color(p.dim).child("No conflict markers in this file: edit it, or mark it resolved.")
        : v_flex().id("gitdeck-resolve").flex_1().min_h_0().overflow_y_scrollbar().font_family(monoFont()).text_xs().children(blocks),
    );
}

export function changesPane(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const { view } = parts;
  const error = view.error === null ? null : div().px(10).py(4).flex_shrink_0().text_xs().text_color(p.removed).bg(p.raised).child(view.error);
  return v_flex()
    .flex_1()
    .min_h_0()
    .border_t_1()
    .border_color(p.border)
    .bg(p.surface)
    .when(error !== null, (el) => el.child(error ?? div()))
    .when(parts.agentNote?.kind === "done", (el) => el.child(parts.agentNote ? doneBanner(parts.agentNote, p, a) : div()))
    .child(
      view.resolving
        ? resolvePane(view.resolving, p, a)
        : v_flex()
            .flex_1()
            .min_h_0()
            .child(filesBar(parts, p, a))
            .child(v_flex().id("changes-files").flex_1().min_h_0().overflow_y_scrollbar().pb(6).children(fileLists(parts, p, a))),
    )
    .child(commitBox(parts, p, a));
}
