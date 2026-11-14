// One side of an uncommitted file in the viewer tab, to stage (or unstage) by
// hunk or line: a click on a hunk header does the whole hunk, a click on a line
// picks it, and the bar's button does the picked lines.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import type { DiffRow } from "../core/git/diff.ts";
import type { LinePicks } from "../core/linePicks.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

const LIST = "gitdeck-stage-diff";
const ROW = 18;

export interface StageParts {
  picks: LinePicks;
  staged: boolean;
  /** Partial staging writes a patch file: this machine only. */
  local: boolean;
  busy: boolean;
  error: string | null;
}

export interface StageActions {
  /** A diff row was clicked: a hunk header stages the hunk, a line toggles its pick. */
  click: (row: number, cx: Context) => void;
  apply: (cx: Context) => void;
}

function diffRow(r: DiffRow, picked: boolean, p: Palette): Element {
  const base = h_flex().h(ROW).gap(6).pr(8).items_center().whitespace_nowrap().cursor_pointer().hover((el) => el.bg(p.hover));
  if (r.kind === "hunk") return base.bg(p.raised).text_color(p.info).child(div().pl(8).truncate().child(r.text));
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

/** The hint line: what a click does, the apply button, and the last error. */
function hintBar(parts: StageParts, p: Palette, a: StageActions): Element {
  const verb = parts.staged ? "Unstage" : "Stage";
  const n = parts.picks.picked.size;
  const hint = !parts.local ? "Partial staging works only for repos on this machine" : `Click a hunk header to ${verb.toLowerCase()} it, or pick lines`;
  return h_flex()
    .h(30)
    .px(10)
    .gap(8)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(div().flex_1().min_w_0().truncate().text_xs().text_color(parts.error ? p.removed : p.dim).child(parts.error ?? hint))
    .when(n > 0, (el) => el.child(textButton("apply-picked", `${verb} ${n} line${n === 1 ? "" : "s"}`, p, a.apply, true, !parts.busy)));
}

export function stagePane(parts: StageParts, p: Palette, a: StageActions): Element {
  const rows = parts.picks.diff.rows;
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(hintBar(parts, p, a))
    .child(
      rows.length === 0
        ? div().p(12).text_color(p.dim).child(`Nothing left to ${parts.staged ? "unstage" : "stage"} in this file.`)
        : div()
            .relative()
            .flex_1()
            .min_h_0()
            .font_family(monoFont())
            .text_xs()
            .child(
              v_virtual_list(LIST, rows.length, ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r, k) => diffRow(r, parts.picks.picked.has(range.start + k), p)),
              )
                .on_item_click((key, cx) => a.click(Number(key), cx))
                .size_full(),
            )
            .child(Scrollbar.vertical(LIST).absolute().inset_0()),
    );
}
