// Below the graph: the selected commit (or the work tree's changes), its files,
// and one file's diff.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import type { DiffRow } from "../core/git/diff.ts";
import type { CommitFile } from "../core/git/show.ts";
import type { RepoStatus, StatusEntry } from "../core/git/status.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { dateTime } from "../core/time.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const DIFF_LIST = "githerd-diff";
const DIFF_ROW = 18;
const MAX_FILES = 500;

export interface DetailActions {
  openFile: (path: string, cx: Context) => void;
  closeFile: (cx: Context) => void;
  close: (cx: Context) => void;
  /** A committed file's blame or history. */
  inspectFile: (kind: "blame" | "file-log", path: string, cx: Context) => void;
}

function statusColor(letter: string, p: Palette) {
  if (letter === "D" || letter === "!") return p.removed;
  if (letter === "A" || letter === "U") return p.added;
  if (letter === "R" || letter === "C") return p.info;
  return p.changed;
}

function fileRow(id: string, letter: string, path: string, counts: string, p: Palette, onOpen: (cx: Context) => void): Element {
  const cut = path.lastIndexOf("/");
  return h_flex()
    .id(id)
    .h(22)
    .px(10)
    .gap(8)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => onOpen(cx))
    .child(div().w(12).flex_shrink_0().text_color(statusColor(letter, p)).child(letter))
    .child(div().flex_shrink_0().child(cut >= 0 ? path.slice(cut + 1) : path))
    .child(div().min_w_0().flex_1().truncate().text_color(p.dim).child(cut >= 0 ? path.slice(0, cut + 1) : ""))
    .child(div().flex_shrink_0().text_xs().text_color(p.dim).child(counts));
}

function counts(f: CommitFile): string {
  return f.binary ? "binary" : `+${f.added} −${f.deleted}`;
}

function bar(title: string, p: Palette, ...buttons: Element[]): Element {
  return h_flex()
    .h(28)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.muted).child(title))
    .children(buttons);
}

function line(label: string, value: string, p: Palette, mono = false): Element {
  return h_flex()
    .gap(8)
    .text_xs()
    .child(div().w(64).flex_shrink_0().text_color(p.dim).child(label))
    .child(div().min_w_0().truncate().text_color(p.muted).when(mono, (el) => el.font_family(monoFont())).child(value));
}

function commitBody(view: HistoryView, p: Palette, actions: DetailActions): Element[] {
  const c = view.commit;
  if (!c) return [div().p(12).text_color(p.dim).child("Reading commit…")];
  if (c.error || !c.detail) return [div().p(12).text_color(p.removed).child(c.error ?? "Commit not found")];
  const d = c.detail;
  const [subject = "", ...rest] = d.message.split("\n");
  const body = rest.join("\n").trim();
  const header = v_flex()
    .p(10)
    .gap(3)
    .border_b_1()
    .border_color(p.border)
    .child(div().font_medium().child(subject))
    .when(body !== "", (el) => el.child(div().pt(2).pb(4).text_xs().text_color(p.muted).child(body)))
    .child(line("commit", d.hash, p, true))
    .child(line("author", `${d.author} <${d.email}>  ${dateTime(d.time)}`, p))
    .when(d.committer !== d.author || d.commitTime !== d.time, (el) => el.child(line("committer", `${d.committer}  ${dateTime(d.commitTime)}`, p)))
    .when(d.parents.length > 0, (el) => el.child(line(d.parents.length > 1 ? "parents" : "parent", d.parents.map((h) => h.slice(0, 10)).join(" "), p, true)));
  const files = c.files.slice(0, MAX_FILES).map((f, i) =>
    fileRow(`cf:${i}`, f.status, f.path, counts(f), p, (cx) => actions.openFile(f.path, cx)),
  );
  const title = div().px(10).pt(8).pb(2).text_xs().text_color(p.dim).child(`${c.files.length} file${c.files.length === 1 ? "" : "s"} changed`);
  return [header, title, ...files];
}

function entryLetter(e: StatusEntry): string {
  if (e.kind === "untracked") return "U";
  if (e.kind === "conflict") return "!";
  if (e.kind === "renamed") return "R";
  return e.index !== "." ? e.index : e.worktree;
}

function worktreeBody(status: RepoStatus | null, p: Palette, actions: DetailActions): Element[] {
  const files = (status?.entries ?? []).filter((e) => e.kind !== "ignored");
  return files.slice(0, MAX_FILES).map((e, i) =>
    fileRow(`wf:${i}`, entryLetter(e), e.path, e.kind !== "untracked" && e.index !== "." ? "staged" : "", p, (cx) => actions.openFile(e.path, cx)),
  );
}

function diffRow(r: DiffRow, p: Palette): Element {
  const num = (n: number | null) => div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(n === null ? "" : String(n));
  const base = h_flex().h(DIFF_ROW).gap(6).pr(8).items_center().whitespace_nowrap();
  if (r.kind === "hunk") return base.bg(p.raised).text_color(p.info).child(div().pl(8).truncate().child(r.text));
  if (r.kind === "note") return base.text_color(p.dim).child(div().pl(8).child(r.text));
  const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
  const color = r.kind === "add" ? p.added : r.kind === "del" ? p.removed : p.foreground;
  return base
    .when(r.kind === "add", (el) => el.bg(p.addedBg))
    .when(r.kind === "del", (el) => el.bg(p.removedBg))
    .child(num(r.old))
    .child(num(r.new))
    .child(div().w(10).flex_shrink_0().text_color(color).child(mark))
    .child(div().flex_1().min_w_0().truncate().text_color(color).child(r.text === "" ? " " : r.text));
}

function diffView(view: HistoryView, p: Palette, actions: DetailActions): Element {
  const diff = view.diff;
  const rows = diff ? [...diff.rows, ...(diff.truncated ? [{ kind: "note", old: null, new: null, text: "Diff cut short: too many lines" } as DiffRow] : [])] : [];
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(
      bar(
        view.file ?? "",
        p,
        textButton("diff-back", "← Files", p, actions.closeFile),
        ...(view.selected !== UNCOMMITTED && view.file !== null
          ? [
              textButton("diff-blame", "Blame", p, (cx) => actions.inspectFile("blame", view.file ?? "", cx)),
              textButton("diff-history", "History", p, (cx) => actions.inspectFile("file-log", view.file ?? "", cx)),
            ]
          : []),
        textButton("diff-close", "×", p, actions.close),
      ),
    )
    .child(
      diff
        ? div()
            .relative()
            .flex_1()
            .min_h_0()
            .font_family(monoFont())
            .text_xs()
            .child(v_virtual_list(DIFF_LIST, rows.length, DIFF_ROW, (i) => String(i), (range) => rows.slice(range.start, range.end).map((r) => diffRow(r, p))).size_full())
            .child(Scrollbar.vertical(DIFF_LIST).absolute().inset_0())
        : div().p(12).text_color(p.dim).child("Reading diff…"),
    );
}

export function details(view: HistoryView, status: RepoStatus | null, p: Palette, actions: DetailActions): Element | null {
  if (view.selected === null) return null;
  const pane = v_flex().flex_1().min_h_0().border_t_1().border_color(p.border).bg(p.surface);
  if (view.file !== null) return pane.child(diffView(view, p, actions));
  const uncommitted = view.selected === UNCOMMITTED;
  const title = uncommitted ? "Uncommitted changes" : `Commit ${view.selected.slice(0, 10)}`;
  const body = uncommitted ? worktreeBody(status, p, actions) : commitBody(view, p, actions);
  return pane
    .child(bar(title, p, textButton("details-close", "×", p, actions.close)))
    .child(v_flex().id("details-body").flex_1().min_h_0().overflow_y_scrollbar().pb(6).children(body));
}
