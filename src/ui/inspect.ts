// The inspect pane: a file's blame or history, or the reflog. A click on a
// row jumps to its commit in the graph.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import type { InspectView } from "../core/inspect.ts";
import { MAX_STATS, type Stats } from "../core/stats.ts";
import { ago } from "../core/time.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const LIST = "githerd-inspect";
const ROW = 18;

export interface InspectActions {
  jump: (hash: string, cx: Context) => void;
  close: (cx: Context) => void;
  /** The tree: open a file, or go back to the list. */
  openTreeFile: (index: number, cx: Context) => void;
  closeTreeFile: (cx: Context) => void;
}

interface Row {
  /** The commit a click jumps to; the tree's rows open a file instead. */
  hash: string;
  cells: Element[];
}

function rowsOf(v: InspectView, p: Palette, now: number): Row[] {
  const dim = (text: string, w: number) => div().w(w).flex_shrink_0().truncate().text_color(p.dim).child(text);
  if (v.kind === "blame") {
    return (v.data?.items ?? []).map((l) => ({
      hash: l.hash,
      cells: [
        dim(l.first ? `${l.hash.slice(0, 7)} ${l.author}` : "", 150),
        dim(l.first ? ago(now, l.time) : "", 60),
        div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(String(l.line)),
        div().flex_1().min_w_0().truncate().child(l.text === "" ? " " : l.text),
      ],
    }));
  }
  if (v.kind === "file-log") {
    return (v.data?.items ?? []).map((c) => ({
      hash: c.hash,
      cells: [dim(c.hash.slice(0, 7), 60), div().flex_1().min_w_0().truncate().child(c.subject), dim(c.author, 120), dim(ago(now, c.time), 60)],
    }));
  }
  if (v.kind === "tree") {
    if (v.file) {
      const blob = v.blob;
      if (!blob) return [{ hash: "", cells: [div().text_color(p.dim).child("Reading file…")] }];
      if (blob.note) return [{ hash: "", cells: [div().text_color(p.dim).child(blob.note)] }];
      return blob.lines.map((text, i) => ({
        hash: "",
        cells: [div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(String(i + 1)), div().flex_1().min_w_0().truncate().child(text === "" ? " " : text)],
      }));
    }
    return (v.data?.items ?? []).map((f) => ({
      hash: "",
      cells: [div().flex_1().min_w_0().truncate().child(f.path), dim(f.kind === "file" ? `${f.size} B` : f.kind, 80)],
    }));
  }
  if (v.kind === "stats") return statsRows(v.data, p, now);
  if (v.kind === "prs") {
    const color = (s: string) => (s === "OPEN" ? p.added : s === "MERGED" ? p.info : p.dim);
    return (v.data?.items ?? []).map((pr) => ({
      hash: pr.head,
      cells: [
        dim(`#${pr.number}`, 50),
        div().w(60).flex_shrink_0().text_color(color(pr.state)).child(pr.draft ? "DRAFT" : pr.state),
        div().flex_1().min_w_0().truncate().child(pr.title),
        dim(pr.branch, 140),
        dim(pr.author, 90),
        dim(ago(now, pr.updated), 60),
      ],
    }));
  }
  return (v.data?.items ?? []).map((e) => ({
    hash: e.hash,
    cells: [dim(e.name, 80), dim(e.hash.slice(0, 7), 60), div().flex_1().min_w_0().truncate().child(e.action), dim(ago(now, e.time), 60)],
  }));
}

function bar(count: number, most: number, p: Palette): Element {
  const width = most === 0 ? 0 : Math.max(2, Math.round((count / most) * 160));
  return div().w(160).flex_shrink_0().child(div().h(8).w(width).rounded(2).bg(p.accent));
}

/** Totals, then authors and months, each with a bar against the largest. */
function statsRows(s: Stats | null, p: Palette, now: number): Row[] {
  if (!s) return [];
  const text = (t: string, color = p.foreground) => ({ hash: "", cells: [div().flex_1().min_w_0().truncate().text_color(color).child(t)] });
  const span = s.first !== null && s.last !== null ? `, first ${ago(now, s.first)}, last ${ago(now, s.last)}` : "";
  const mostAuthor = s.authors[0]?.count ?? 0;
  const mostMonth = Math.max(0, ...s.months.map((m) => m.count));
  const months = s.months.slice(-24);
  return [
    text(`${s.commits}${s.commits >= MAX_STATS ? "+" : ""} commits (no merges) by ${s.authors.length} authors, ${s.files} files${span}`),
    text(`Authors`, p.muted),
    ...s.authors.slice(0, 50).map((a) => ({
      hash: "",
      cells: [div().w(200).flex_shrink_0().truncate().child(`${a.name} <${a.email}>`), bar(a.count, mostAuthor, p), div().text_color(p.dim).child(String(a.count))],
    })),
    text(months.length < s.months.length ? "Commits per month (last 24)" : "Commits per month", p.muted),
    ...months.map((m) => ({ hash: "", cells: [div().w(200).flex_shrink_0().child(m.month), bar(m.count, mostMonth, p), div().text_color(p.dim).child(String(m.count))] })),
  ];
}

function title(v: InspectView): string {
  if (v.kind === "blame") return `Blame: ${v.path} at ${v.rev.slice(0, 10)}`;
  if (v.kind === "file-log") return `History: ${v.path}`;
  if (v.kind === "stats") return "Repository statistics";
  if (v.kind === "prs") return `Pull requests${v.data?.repo ? ` of ${v.data.repo}` : ""} (via gh, read-only): a click jumps to the head commit`;
  if (v.kind === "tree") return v.file ? `${v.file.path} at ${v.rev.slice(0, 10)}` : `Files at ${v.rev.slice(0, 10)} (${v.data?.items.length ?? 0})`;
  return "Reflog: where HEAD has been";
}

export function inspectPane(v: InspectView, p: Palette, a: InspectActions): Element {
  const rows = rowsOf(v, p, Math.floor(Date.now() / 1000));
  const error = v.data?.error ?? null;
  const body =
    v.data === null
      ? div().p(12).text_color(p.dim).child("Reading…")
      : error !== null
        ? div().p(12).text_color(p.removed).child(error)
        : rows.length === 0
          ? div().p(12).text_color(p.dim).child("Nothing to show")
          : div()
            .relative()
            .flex_1()
            .min_h_0()
            .when(v.kind === "blame" || (v.kind === "tree" && v.file !== null), (el) => el.font_family(monoFont()))
            .text_xs()
            .child(
              v_virtual_list(LIST, rows.length, ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r) =>
                  h_flex().h(ROW).px(8).gap(8).items_center().whitespace_nowrap().cursor_pointer().hover((el) => el.bg(p.hover)).children(r.cells),
                ),
              )
                .on_item_click((key, cx) => {
                  if (v.kind === "stats") return;
                  if (v.kind === "tree") return v.file === null ? a.openTreeFile(Number(key), cx) : undefined;
                  const row = rows[Number(key)];
                  if (row) a.jump(row.hash, cx);
                })
                .size_full(),
            )
            .child(Scrollbar.vertical(LIST).absolute().inset_0());
  return v_flex()
    .flex_1()
    .min_h_0()
    .border_t_1()
    .border_color(p.border)
    .bg(p.surface)
    .child(
      h_flex()
        .h(28)
        .px(8)
        .gap(6)
        .items_center()
        .flex_shrink_0()
        .border_b_1()
        .border_color(p.border)
        .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.muted).child(title(v)))
        .when(v.kind === "tree" && v.file !== null, (el) => el.child(textButton("tree-back", "← Files", p, a.closeTreeFile)))
        .child(textButton("inspect-close", "×", p, a.close)),
    )
    .child(body);
}
