// The uncommitted changes: staged and unstaged files with their actions, a
// commit box, and one side of a file's diff whose hunks and lines can be staged.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, Textarea, type TextareaState } from "gpui-base";
import type { ChangesView, Resolving } from "../core/changesView.ts";
import { allChosen, type Choice } from "../core/conflict.ts";
import type { DiffRow } from "../core/git/diff.ts";
import type { AgentNote } from "../core/repoAgents.ts";
import type { ChangeFile, Changes } from "../core/staging.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const LIST = "githerd-stage-diff";
const ROW = 18;
const MAX_FILES = 500;

export interface ChangesActions {
  open: (file: ChangeFile, staged: boolean, cx: Context) => void;
  closeDiff: (cx: Context) => void;
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
  /** A diff row was clicked: a hunk header stages the hunk, a line toggles its pick. */
  diffClick: (row: number, cx: Context) => void;
  applyPicked: (cx: Context) => void;
  toggleAmend: (cx: Context) => void;
  /** Writes a message drafted from the staged files into the box. */
  suggest: (cx: Context) => void;
  commit: (cx: Context) => void;
  /** Moves HEAD back one commit; its changes stay staged. */
  undo: (cx: Context) => void;
  /** Lists an untracked file in .git/info/exclude so it stops showing. */
  ignore: (file: ChangeFile, cx: Context) => void;
  close: (cx: Context) => void;
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
}

function letterColor(letter: string, p: Palette) {
  if (letter === "D") return p.removed;
  if (letter === "A" || letter === "U") return p.added;
  if (letter === "R" || letter === "C") return p.info;
  return p.changed;
}

function fileRow(id: string, f: ChangeFile, p: Palette, onOpen: (cx: Context) => void, buttons: Element[]): Element {
  const cut = f.path.lastIndexOf("/");
  return h_flex()
    .id(id)
    .h(24)
    .pl(10)
    .pr(4)
    .gap(8)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => onOpen(cx))
    .child(div().w(14).flex_shrink_0().text_color(letterColor(f.letter, p)).child(f.letter))
    .child(div().flex_shrink_0().child(cut >= 0 ? f.path.slice(cut + 1) : f.path))
    .child(div().min_w_0().flex_1().truncate().text_color(p.dim).child(cut >= 0 ? f.path.slice(0, cut + 1) : ""))
    .children(buttons);
}

function heading(title: string, p: Palette, button: Element | null): Element {
  return h_flex()
    .px(10)
    .pt(8)
    .pb(2)
    .items_center()
    .child(div().flex_1().text_xs().text_color(p.dim).child(title))
    .when(button !== null, (el) => el.child(button ?? div()));
}

function fileLists(parts: ChangesParts, p: Palette, a: ChangesActions): Element[] {
  const { changes, view } = parts;
  const staged = changes.staged.slice(0, MAX_FILES).map((f, i) =>
    fileRow(`sf:${i}`, f, p, (cx) => a.open(f, true, cx), [textButton(`un:${i}`, "Unstage", p, (cx) => a.unstage([f.path], cx))]),
  );
  const unstaged = changes.unstaged.slice(0, MAX_FILES).map((f, i) => {
    const key = `discard:${f.path}`;
    const asking = view.confirm === key;
    return fileRow(`uf:${i}`, f, p, (cx) => a.open(f, false, cx), [
      ...(f.untracked && parts.local ? [textButton(`ig:${i}`, "Ignore", p, (cx) => a.ignore(f, cx))] : []),
      textButton(`dc:${i}`, asking ? (f.untracked ? "Delete file?" : "Discard?") : "Discard", p, (cx) => a.discard(f, cx), asking),
      textButton(`st:${i}`, "Stage", p, (cx) => a.stage([f.path], cx)),
    ]);
  });
  const conflicts = changes.conflicts.map((f, i) => fileRow(`cf:${i}`, f, p, (cx) => a.open(f, false, cx), [
    ...(parts.local ? [textButton(`cr:${i}`, "Resolve…", p, (cx) => a.resolve(f, cx))] : []),
    textButton(`co:${i}`, "Take ours", p, (cx) => a.takeSide(f, "ours", cx)),
    textButton(`ct:${i}`, "Take theirs", p, (cx) => a.takeSide(f, "theirs", cx)),
    textButton(`cs:${i}`, "Mark resolved", p, (cx) => a.stage([f.path], cx)),
  ]));
  const all = (files: readonly ChangeFile[]) => files.map((f) => f.path);
  return [
    ...(conflicts.length > 0 ? [heading(`Conflicts ${conflicts.length}`, p, null), ...conflicts] : []),
    heading(`Staged ${changes.staged.length}`, p, changes.staged.length > 0 ? textButton("unstage-all", "Unstage all", p, (cx) => a.unstage(all(changes.staged), cx)) : null),
    ...staged,
    heading(`Changes ${changes.unstaged.length}`, p, changes.unstaged.length > 0 ? textButton("stage-all", "Stage all", p, (cx) => a.stage(all(changes.unstaged), cx)) : null),
    ...unstaged,
  ];
}

const NOTE_ICON = { working: "⏳", blocked: "✋", done: "✅" } as const;

function agentBanner(note: AgentNote, p: Palette): Element {
  const color = note.kind === "working" ? p.changed : note.kind === "blocked" ? p.removed : p.added;
  return h_flex()
    .px(10)
    .py(4)
    .gap(6)
    .flex_shrink_0()
    .items_center()
    .text_xs()
    .bg(p.raised)
    .text_color(color)
    .child(NOTE_ICON[note.kind])
    .child(div().min_w_0().flex_1().truncate().child(note.text));
}

function commitLabel(parts: ChangesParts): string {
  const { view } = parts;
  if (view.busy) return "Working…";
  if (view.confirm === "commit") return "Commit anyway?";
  return view.amend ? "Amend" : `Commit ${parts.changes.staged.length}`;
}

function commitBox(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const { view } = parts;
  return v_flex()
    .flex_shrink_0()
    .p(8)
    .gap(6)
    .border_t_1()
    .border_color(p.border)
    .child(div().rounded(4).border_1().border_color(p.border).bg(p.chrome).px(6).py(4).child(Textarea.new(parts.message).w_full().text_sm()))
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(textButton("suggest", "✨ Suggest", p, a.suggest))
        .child(textButton("amend", view.amend ? "☑ Amend last commit" : "☐ Amend last commit", p, a.toggleAmend, view.amend))
        .child(div().flex_1())
        .when(parts.undoable && !view.busy, (el) => el.child(textButton("undo-commit", "↶ Undo commit", p, a.undo)))
        .child(textButton("commit", commitLabel(parts), p, a.commit, true)),
    );
}

function diffRow(r: DiffRow, picked: boolean, p: Palette): Element {
  const base = h_flex().h(ROW).gap(6).pr(8).items_center().whitespace_nowrap().cursor_pointer().hover((el) => el.bg(p.hover));
  if (r.kind === "hunk") return base.bg(p.raised).text_color(p.info).child(div().pl(8).truncate().child(`${r.text}`));
  if (r.kind === "note") return base.text_color(p.dim).child(div().pl(8).child(r.text));
  const color = r.kind === "add" ? p.added : r.kind === "del" ? p.removed : p.foreground;
  const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
  return base
    .when(picked, (el) => el.bg(p.selected))
    .when(!picked && r.kind === "add", (el) => el.bg(p.addedBg))
    .when(!picked && r.kind === "del", (el) => el.bg(p.removedBg))
    .child(div().w(12).flex_shrink_0().text_color(p.accent).child(picked ? "●" : ""))
    .child(div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(String(r.old ?? r.new ?? "")))
    .child(div().w(10).flex_shrink_0().text_color(color).child(mark))
    .child(div().flex_1().min_w_0().truncate().text_color(color).child(r.text === "" ? " " : r.text));
}

function diffPane(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const { view } = parts;
  const open = view.open;
  const rows = view.diff?.rows ?? [];
  const verb = open?.staged ? "Unstage" : "Stage";
  const hint = !parts.local
    ? "Partial staging works only for repos on this machine"
    : `Click a hunk header to ${verb.toLowerCase()} it, or pick lines`;
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
        .child(textButton("stage-back", "← Files", p, a.closeDiff))
        .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.muted).child(`${open?.staged ? "Staged" : "Unstaged"}: ${open?.path ?? ""}`))
        .when(view.picked.size > 0, (el) => el.child(textButton("apply-picked", `${verb} ${view.picked.size} line${view.picked.size === 1 ? "" : "s"}`, p, a.applyPicked, true))),
    )
    .child(div().px(10).py(2).flex_shrink_0().text_xs().text_color(p.dim).child(hint))
    .child(
      view.diff
        ? div()
            .relative()
            .flex_1()
            .min_h_0()
            .font_family(monoFont())
            .text_xs()
            .child(
              v_virtual_list(LIST, rows.length, ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r, k) => diffRow(r, view.picked.has(range.start + k), p)),
              )
                .on_item_click((key, cx) => a.diffClick(Number(key), cx))
                .size_full(),
            )
            .child(Scrollbar.vertical(LIST).absolute().inset_0())
        : div().p(12).text_color(p.dim).child("Reading diff…"),
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
        : v_flex().id("githerd-resolve").flex_1().min_h_0().overflow_y_scrollbar().font_family(monoFont()).text_xs().children(blocks),
    );
}

export function changesPane(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const { view } = parts;
  const top = h_flex()
    .h(28)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(div().flex_1().text_xs().text_color(p.muted).child("Uncommitted changes"))
    .child(textButton("changes-close", "×", p, a.close));
  const error = view.error === null ? null : div().px(10).py(4).flex_shrink_0().text_xs().text_color(p.removed).bg(p.raised).child(view.error);
  return v_flex()
    .flex_1()
    .min_h_0()
    .border_t_1()
    .border_color(p.border)
    .bg(p.surface)
    .child(top)
    .when(error !== null, (el) => el.child(error ?? div()))
    .when(parts.agentNote !== null, (el) => el.child(parts.agentNote ? agentBanner(parts.agentNote, p) : div()))
    .child(
      view.resolving
        ? resolvePane(view.resolving, p, a)
        : view.open
        ? diffPane(parts, p, a)
        : v_flex().id("changes-files").flex_1().min_h_0().overflow_y_scrollbar().pb(6).children(fileLists(parts, p, a)),
    )
    .child(commitBox(parts, p, a));
}
