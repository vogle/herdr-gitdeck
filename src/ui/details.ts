// Below the graph: the selected commit (or the work tree's changes), its files,
// and one file's diff.

import { div, image, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, type VirtualListScrollHandle } from "gpui-base";
import type { Diff, DiffRow } from "../core/git/diff.ts";
import type { ImagePair } from "../core/imageDiff.ts";
import type { CommitFile } from "../core/git/show.ts";
import type { RepoStatus, StatusEntry } from "../core/git/status.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { dateTime } from "../core/time.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const DIFF_LIST = "gitdeck-diff";
const DIFF_ROW = 18;
const MAX_FILES = 500;

export interface DetailActions {
  /** Opens the file's diff in the viewer tab. */
  openFile: (path: string, cx: Context) => void;
  close: (cx: Context) => void;
  /** Every file as it was at the selected commit. */
  browseTree: (cx: Context) => void;
}

export function statusColor(letter: string, p: Palette) {
  if (letter === "D" || letter === "!") return p.removed;
  if (letter === "A" || letter === "?") return p.added;
  if (letter === "R" || letter === "C") return p.info;
  return p.changed;
}

export function fileRow(id: string, letter: string, path: string, counts: string, p: Palette, onOpen: (cx: Context) => void): Element {
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

export function counts(f: CommitFile): string {
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
  if (e.kind === "untracked") return "?";
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

function diffRow(r: DiffRow, p: Palette, hit = false, picked = false): Element {
  const num = (n: number | null) => div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(n === null ? "" : String(n));
  const base = h_flex()
    .h(DIFF_ROW)
    .gap(6)
    .pr(8)
    .items_center()
    .whitespace_nowrap()
    .when(hit || picked, (el) => el.border_l_2().border_color(picked ? p.changed : p.accent));
  if (hit) return withHit(base, r, p);
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

/** The row the find box is on: the selection color over everything, so it stands out. */
function withHit(base: Element, r: DiffRow, p: Palette): Element {
  const num = (n: number | null) => div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(n === null ? "" : String(n));
  const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
  const lined = r.kind !== "hunk" && r.kind !== "note";
  return lined
    ? base.bg(p.selected).child(num(r.old)).child(num(r.new)).child(div().w(10).flex_shrink_0().child(mark)).child(div().flex_1().min_w_0().truncate().child(r.text === "" ? " " : r.text))
    : base.bg(p.selected).child(div().pl(8).truncate().child(r.text));
}

/** Where find in the diff stands: the scroll it moves, and the row it is on; and the rows picked for a note. */
export interface DiffFind {
  scroll: VirtualListScrollHandle;
  hit: number | null;
  picked?: { from: number; to: number } | null;
  /** A row clicked: picks lines for a note to the agent. */
  pick?: (row: number, cx: Context) => void;
}

function side(label: string, path: string | null, p: Palette): Element {
  return v_flex()
    .flex_1()
    .min_w_0()
    .gap(4)
    .items_center()
    .child(div().text_xs().text_color(p.dim).child(label))
    .child(path === null ? div().text_xs().text_color(p.dim).child("(none)") : image(path).max_w(360).max_h(240));
}

/** A changed image's before and after, or why they can't be drawn. */
function imagePair(pair: ImagePair, p: Palette): Element {
  const box = h_flex().flex_shrink_0().p(8).gap(12).border_b_1().border_color(p.border).bg(p.chrome);
  return pair.note !== null ? box.child(div().text_xs().text_color(p.dim).child(pair.note)) : box.child(side("Before", pair.old, p)).child(side("After", pair.new, p));
}

/** A diff's rows (and a changed image's two sides), filling the space it is given. */
export function diffBody(diff: Diff | null, p: Palette, find?: DiffFind): Element {
  const rows = diff ? [...diff.rows, ...(diff.truncated ? [{ kind: "note", old: null, new: null, text: "Diff cut short: too many lines" } as DiffRow] : [])] : [];
  return v_flex()
    .flex_1()
    .min_h_0()
    .when(Boolean(diff?.images), (el) => el.child(diff?.images ? imagePair(diff.images, p) : div()))
    .child(
      diff
        ? div()
            .relative()
            .flex_1()
            .min_h_0()
            .font_family(monoFont())
            .text_xs()
            .child(
              v_virtual_list(DIFF_LIST, rows.length, DIFF_ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r, k) => {
                  const i = range.start + k;
                  const picked = find?.picked != null && i >= find.picked.from && i <= find.picked.to;
                  return diffRow(r, p, find?.hit === i, picked);
                }),
              )
                .when(find !== undefined, (el) => (find ? el.track_scroll(find.scroll) : el))
                .when(find?.pick !== undefined, (el) => el.cursor_pointer().on_item_click((key, cx) => find?.pick?.(Number(key), cx)))
                .size_full(),
            )
            .child(Scrollbar.vertical(DIFF_LIST).absolute().inset_0())
        : div().p(12).text_color(p.dim).child("Reading diff…"),
    );
}

export function details(view: HistoryView, status: RepoStatus | null, p: Palette, actions: DetailActions): Element | null {
  if (view.selected === null) return null;
  const pane = v_flex().flex_1().min_h_0().border_t_1().border_color(p.border).bg(p.surface);
  const uncommitted = view.selected === UNCOMMITTED;
  const title = uncommitted ? "Uncommitted changes" : `Commit ${view.selected.slice(0, 10)}`;
  const body = uncommitted ? worktreeBody(status, p, actions) : commitBody(view, p, actions);
  return pane
    .child(
      bar(
        title,
        p,
        ...(uncommitted ? [] : [textButton("details-tree", "Files at commit", p, actions.browseTree)]),
        textButton("details-close", "← Back", p, actions.close),
      ),
    )
    .child(v_flex().id("details-body").flex_1().min_h_0().overflow_y_scrollbar().pb(6).children(body));
}
