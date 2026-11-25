// The inspect pane: a file's blame or history, or the reflog. A click on a
// row jumps to its commit in the graph.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import type { ForgeChoice } from "../core/forge/index.ts";
import { blameHead, type InspectView } from "../core/inspect.ts";
import { ago } from "../core/time.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const LIST = "gitdeck-inspect";
const ROW = 18;

export interface InspectActions {
  jump: (hash: string, cx: Context) => void;
  close: (cx: Context) => void;
  /** Names origin's forge, for a host gitdeck doesn't know. */
  setForge: (kind: ForgeChoice, cx: Context) => void;
}

interface Row {
  /** The commit a click jumps to. */
  hash: string;
  /** Built when the list lays the row out: a virtual list draws only elements made inside its renderer. */
  cells: () => Element[];
}

function rowsOf(v: InspectView, p: Palette, now: number): Row[] {
  const dim = (text: string, w: number) => div().w(w).flex_shrink_0().truncate().text_color(p.dim).child(text);
  if (v.kind === "blame") {
    return (v.data?.items ?? []).map((l) => ({
      hash: l.hash,
      cells: () => [
        dim(blameHead(l), 150),
        dim(l.first ? ago(now, l.time) : "", 60),
        div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(String(l.line)),
        div().flex_1().min_w_0().truncate().child(l.text === "" ? " " : l.text),
      ],
    }));
  }
  if (v.kind === "file-log") {
    return (v.data?.items ?? []).map((c) => ({
      hash: c.hash,
      cells: () => [dim(c.hash.slice(0, 7), 60), div().flex_1().min_w_0().truncate().child(c.subject), dim(c.author, 120), dim(ago(now, c.time), 60)],
    }));
  }
  if (v.kind === "prs") {
    const color = (s: string) => (s === "OPEN" ? p.added : s === "MERGED" ? p.info : p.dim);
    return (v.data?.items ?? []).map((pr) => ({
      hash: pr.head,
      cells: () => [
        dim(`#${pr.number}`, 50),
        div().w(60).flex_shrink_0().text_color(color(pr.state)).child(pr.draft ? "DRAFT" : pr.state),
        div().flex_1().min_w_0().truncate().child(pr.title),
        dim(pr.branch, 140),
        dim(pr.author, 90),
        dim(ago(now, pr.updated), 60),
      ],
    }));
  }
  // A commit's files show in the commit pane (treePane), not here.
  if (v.kind === "tree") return [];
  return (v.data?.items ?? []).map((e) => ({
    hash: e.hash,
    cells: () => [dim(e.name, 80), dim(e.hash.slice(0, 7), 60), div().flex_1().min_w_0().truncate().child(e.action), dim(ago(now, e.time), 60)],
  }));
}

function title(v: InspectView): string {
  if (v.kind === "blame") return `Blame: ${v.path} at ${v.rev.slice(0, 10)}`;
  if (v.kind === "file-log") return `History: ${v.path}`;
  if (v.kind === "prs") {
    // Until a forge is read there's no telling which word (or CLI) it is.
    if (v.data == null || v.data.repo === null) return "Pull / merge requests (read-only)";
    const mr = v.data?.label === "MR";
    return `${mr ? "Merge requests" : "Pull requests"}${v.data?.repo ? ` of ${v.data.repo}` : ""} (via ${mr ? "glab" : "gh"}, read-only): a click jumps to the head commit`;
  }
  return "Reflog: where HEAD has been";
}

export function inspectPane(v: InspectView, p: Palette, a: InspectActions): Element {
  const rows = rowsOf(v, p, Math.floor(Date.now() / 1000));
  const error = v.data?.error ?? null;
  const unnamed = v.kind === "prs" && v.data?.host != null;
  const body =
    v.data === null
      ? div().p(12).text_color(p.dim).child("Reading…")
      : unnamed
        ? h_flex()
            .p(12)
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w_0().text_color(p.dim).child(error ?? ""))
            .child(textButton("prs-forge-gitlab", "GitLab", p, (cx) => a.setForge("gitlab", cx)))
            .child(textButton("prs-forge-github", "GitHub", p, (cx) => a.setForge("github", cx)))
            .child(textButton("prs-forge-none", "Neither", p, (cx) => a.setForge("none", cx)))
      : error !== null
        ? div().p(12).text_color(p.removed).child(error)
        : rows.length === 0
          ? div().p(12).text_color(p.dim).child("Nothing to show")
          : div()
            .relative()
            .flex_1()
            .min_h_0()
            .when(v.kind === "blame", (el) => el.font_family(monoFont()))
            .text_xs()
            .child(
              v_virtual_list(LIST, rows.length, ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r) =>
                  h_flex().h(ROW).px(8).gap(8).items_center().whitespace_nowrap().cursor_pointer().hover((el) => el.bg(p.hover)).children(r.cells()),
                ),
              )
                .on_item_click((key, cx) => {
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
        .child(textButton("inspect-close", "×", p, a.close)),
    )
    .child(body);
}
