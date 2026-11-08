// The commit graph: one row per commit with its lane lines, refs, subject,
// author and age. A virtual list, so only the rows on screen are built.

import { div, PathBuilder, type Color, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, type VirtualListScrollHandle } from "gpui-base";
import type { Commit } from "../core/git/log.ts";
import type { Ref } from "../core/git/refs.ts";
import type { LaneRow } from "../core/graph/lanes.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { ago } from "../core/time.ts";
import type { Palette } from "./style.ts";

export const ROW = 24;
const LANE = 14;
const PAD = 6;
const MAX_LABELS = 3;
export const GRAPH_LIST = "githerd-graph";
const MORE = "githerd:more";

const laneX = (lane: number) => PAD + lane * LANE + LANE / 2;
const laneColor = (p: Palette, lane: number): Color => p.lanes[lane % p.lanes.length] ?? p.accent;

function graphCell(row: LaneRow, uncommitted: boolean, width: number, p: Palette): Element {
  // One stroked path per color keeps a row to a few paints however many lanes pass.
  const paths = new Map<string, { color: Color; path: PathBuilder }>();
  for (const s of row.segments) {
    const color = s.dashed ? p.dim : laneColor(p, s.to === s.from ? s.from : Math.max(s.from, s.to));
    const key = `${color}${s.dashed ? "-" : ""}`;
    const start = paths.get(key)?.path ?? (s.dashed ? PathBuilder.stroke(1.5).dash_array([3, 3]) : PathBuilder.stroke(1.5));
    const [ax, ay, bx, by] = [laneX(s.from), s.fromY * ROW, laneX(s.to), s.toY * ROW];
    const moved = start.move_to(ax, ay);
    const mid = (ay + by) / 2;
    paths.set(key, { color, path: ax === bx ? moved.line_to(bx, by) : moved.cubic_bezier_to(bx, by, ax, mid, bx, mid) });
  }
  const color = uncommitted ? p.dim : laneColor(p, row.lane);
  const dot = div().absolute().left(laneX(row.lane) - 4).top(ROW / 2 - 4).w(8).h(8).rounded(4);
  return div()
    .relative()
    .flex_shrink_0()
    .w(width)
    .h(ROW)
    .overflow_hidden()
    .children([...paths.values()].map(({ color, path }) => window.paint_path(path.build(), color).absolute().top(0).left(0).size_full()))
    .child(uncommitted ? dot.bg(p.surface).border_2().border_color(color) : dot.bg(color));
}

function label(ref: Ref, p: Palette, color: Color): Element {
  const edge = ref.kind === "tag" ? p.changed : ref.kind === "remote" ? p.dim : color;
  return div()
    .flex_shrink_0()
    .px(5)
    .rounded(3)
    .border_1()
    .border_color(edge)
    .text_xs()
    .text_color(ref.current ? p.foreground : p.muted)
    .when(ref.current, (el) => el.font_medium())
    .child(ref.kind === "tag" ? `◆ ${ref.name}` : ref.name);
}

function labels(refs: readonly Ref[], p: Palette, color: Color): Element[] {
  const shown = refs.slice(0, MAX_LABELS).map((r) => label(r, p, color));
  const rest = refs.length - MAX_LABELS;
  return rest > 0 ? [...shown, div().flex_shrink_0().text_xs().text_color(p.dim).child(`+${rest}`)] : shown;
}

function row(view: HistoryView, i: number, width: number, now: number, p: Palette): Element {
  const commit = view.rows[i] as Commit;
  const uncommitted = commit.hash === UNCOMMITTED;
  const lane = view.lanes.rows[i];
  const here = commit.hash === view.selected;
  const color = lane ? laneColor(p, lane.lane) : p.accent;
  const refs = view.history?.byCommit[commit.hash] ?? [];
  return h_flex()
    .h(ROW)
    .pr(8)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .when(here, (el) => el.bg(p.selected))
    .hover((el) => el.bg(here ? p.selected : p.hover))
    .child(lane && !view.searching ? graphCell(lane, uncommitted, width, p) : div().w(PAD).flex_shrink_0())
    .children(labels(refs, p, color))
    .child(div().flex_1().min_w_0().truncate().text_color(uncommitted ? p.muted : p.foreground).child(commit.subject))
    .child(div().w(80).flex_shrink_0().truncate().text_xs().text_color(p.dim).child(commit.author))
    .child(div().w(32).flex_shrink_0().text_right().text_xs().text_color(p.dim).child(ago(now, commit.time)));
}

function moreRow(p: Palette): Element {
  return div().h(ROW).px(12).flex().items_center().text_xs().text_color(p.accent).cursor_pointer().child("Show older commits");
}

export interface GraphActions {
  pick: (hash: string, cx: Context) => void;
  more: (cx: Context) => void;
}

export function graphList(view: HistoryView, p: Palette, scroll: VirtualListScrollHandle, actions: GraphActions): Element {
  const limited = Boolean(view.history?.limited) && !view.searching;
  const count = view.rows.length + (limited ? 1 : 0);
  const width = PAD * 2 + Math.max(1, view.lanes.width) * LANE;
  const now = Math.floor(Date.now() / 1000);
  if (view.history === null) return v_flex().flex_1().items_center().justify_center().text_color(p.dim).child("Reading history…");
  if (view.history.error) return v_flex().flex_1().p(14).text_color(p.removed).child(view.history.error);
  if (count === 0) {
    const empty = view.searching ? "No commit matches" : "No commits yet";
    return v_flex().flex_1().items_center().justify_center().text_color(p.dim).child(empty);
  }
  return div()
    .relative()
    .flex_1()
    .min_h_0()
    .child(
      v_virtual_list(GRAPH_LIST, count, ROW, (i) => view.rows[i]?.hash ?? MORE, (range) =>
        Array.from({ length: range.end - range.start }, (_x, k) => range.start + k).map((i) =>
          i < view.rows.length ? row(view, i, width, now, p) : moreRow(p),
        ),
      )
        // Rows of a virtual list can't hold handlers: the list reports the row's key.
        .on_item_click((key, cx) => (key === MORE ? actions.more(cx) : actions.pick(key, cx)))
        .track_scroll(scroll)
        .size_full(),
    )
    .child(Scrollbar.vertical(GRAPH_LIST).absolute().inset_0());
}
