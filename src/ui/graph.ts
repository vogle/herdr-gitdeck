// The commit graph: one row per commit with its lane lines, refs, subject,
// author and age. A virtual list, so only the rows on screen are built.

import { div, image, PathBuilder, type Color, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, type VirtualListScrollHandle } from "gpui-base";
import type { Commit } from "../core/git/log.ts";
import type { Ref } from "../core/git/refs.ts";
import type { LaneRow } from "../core/graph/lanes.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { ago } from "../core/time.ts";
import { refLabels, type RefLabel } from "../core/graph/refLabels.ts";
import { remoteKindOf, type RemoteKind } from "../core/graph/remoteKind.ts";
import { authorBadge, splitSubject } from "../core/graph/rowText.ts";
import { ICONS, icon, type Palette } from "./style.ts";

export const ROW = 24;
const LANE = 14;
const PAD = 6;
const MAX_LABELS = 3;
export const GRAPH_LIST = "gitdeck-graph";
const MORE = "gitdeck:more";

const laneX = (lane: number) => PAD + lane * LANE + LANE / 2;
const laneColor = (p: Palette, lane: number): Color => p.lanes[lane % p.lanes.length] ?? p.accent;

function graphCell(row: LaneRow, uncommitted: boolean, merge: boolean, width: number, p: Palette): Element {
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
  // A merge is a ring with a chevron in it, as Fork draws one.
  const ring = div()
    .absolute()
    .left(laneX(row.lane) - 6)
    .top(ROW / 2 - 6)
    .w(12)
    .h(12)
    .rounded(6)
    .border_2()
    .border_color(color)
    .bg(p.surface)
    .flex()
    .items_center()
    .justify_center()
    .child(icon(ICONS.chevron, color, 8));
  return div()
    .relative()
    .flex_shrink_0()
    .w(width)
    .h(ROW)
    .overflow_hidden()
    .children([...paths.values()].map(({ color, path }) => window.paint_path(path.build(), color).absolute().top(0).left(0).size_full()))
    .child(uncommitted ? dot.bg(p.surface).border_2().border_color(color) : merge ? ring : dot.bg(color));
}

const FORGE_ICONS: Readonly<Record<RemoteKind, string>> = { github: ICONS.github, gitlab: ICONS.gitlab, git: ICONS.git };

/** The icons in a label's first box: the forges its remotes are on, else what it is. */
function glyphs(l: RefLabel, remotes: Readonly<Record<string, RemoteKind>>): string[] {
  if (l.kind === "tag") return [ICONS.tag];
  const forges = l.parts.filter((x) => x.kind === "remote").map((x) => FORGE_ICONS[remoteKindOf(x.name, remotes)]);
  return forges.length > 0 ? [...new Set(forges)] : [ICONS.branch];
}

/**
 * A ref label as Fork draws one: the forge (or tag, or branch) icon in a box of
 * its own, then the name on a tint of the lane's color. A remote of the same
 * name shows only as its forge's icon; the tooltip names every ref.
 */
function label(l: RefLabel, p: Palette, color: Color, remotes: Readonly<Record<string, RemoteKind>>): Element {
  const edge = l.kind === "tag" ? tagColor(p) : color;
  const name = l.parts[0]?.text ?? "";
  const fg = l.current ? p.surface : p.foreground;
  return h_flex()
    .flex_shrink_0()
    .h(18)
    .gap(2)
    .items_center()
    .tooltip(l.parts.map((x) => x.name).join(" · "))
    .child(
      h_flex()
        .h_full()
        .px(3)
        .gap(2)
        .items_center()
        .rounded(4)
        .border_1()
        .border_color(edge)
        .children(glyphs(l, remotes).map((g) => icon(g, p.foreground, 11))),
    )
    .child(
      h_flex()
        .h_full()
        .px(5)
        .gap(3)
        .items_center()
        .rounded(4)
        .border_1()
        .border_color(edge)
        .bg(l.current ? edge : (`${edge}33` as Color))
        .when(l.current, (el) => el.child(icon(ICONS.check, fg, 10)))
        .child(div().text_xs().text_color(fg).when(l.current, (el) => el.font_semibold()).child(name)),
    );
}

const tagColor = (p: Palette): Color => p.lanes[2] ?? p.accent;

function labels(refs: readonly Ref[], p: Palette, color: Color, remotes: Readonly<Record<string, RemoteKind>>): Element[] {
  const all = refLabels(refs);
  const shown = all.slice(0, MAX_LABELS).map((l) => label(l, p, color, remotes));
  const rest = all.length - MAX_LABELS;
  return rest > 0 ? [...shown, div().flex_shrink_0().text_xs().text_color(p.dim).child(`+${rest}`)] : shown;
}

/** The subject, its conventional-commit type in bold. */
function subject(text: string, color: Color): Element {
  const { prefix, rest } = splitSubject(text);
  return h_flex()
    .flex_1()
    .min_w_0()
    .gap(3)
    .overflow_hidden()
    .text_color(color)
    .when(prefix !== "", (el) => el.child(div().flex_shrink_0().font_weight(700).child(prefix)))
    .child(div().min_w_0().truncate().child(rest.trimStart()));
}

/** The author's picture when one is saved, else their initials on a color of their own. */
function author(name: string, picture: string | null, p: Palette): Element {
  const { initials, color } = authorBadge(name, p.lanes.length);
  return h_flex()
    .w(96)
    .flex_shrink_0()
    .gap(5)
    .items_center()
    .child(
      picture !== null
        ? image(picture).w(16).h(16).flex_shrink_0().rounded(8)
        : div()
        .w(16)
        .h(16)
        .flex_shrink_0()
        .rounded(8)
        .bg(p.lanes[color] ?? p.accent)
        .flex()
        .items_center()
        .justify_center()
        .text_size(initials.length > 1 ? 7.5 : 9)
        .font_semibold()
        .text_color(p.surface)
        .child(initials),
    )
    .child(div().min_w_0().truncate().text_xs().text_color(p.muted).child(name));
}

/** An author's saved picture, as `image()` takes it; null draws their initials. */
export type AvatarOf = (email: string) => string | null;

function row(view: HistoryView, i: number, width: number, now: number, p: Palette, avatar: AvatarOf): Element {
  const commit = view.rows[i] as Commit;
  const uncommitted = commit.hash === UNCOMMITTED;
  const lane = view.lanes.rows[i];
  const here = commit.hash === view.selected;
  const color = lane ? laneColor(p, lane.lane) : p.accent;
  const refs = view.history?.byCommit[commit.hash] ?? [];
  const merge = commit.parents.length > 1;
  return h_flex()
    .h(ROW)
    .pr(8)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .when(here, (el) => el.bg(p.selected))
    .hover((el) => el.bg(here ? p.selected : p.hover))
    .child(lane && !view.searching ? graphCell(lane, uncommitted, merge, width, p) : div().w(PAD).flex_shrink_0())
    .children(labels(refs, p, color, view.history?.remotes ?? {}))
    // Merge commits are muted.
    .child(subject(commit.subject, uncommitted ? p.muted : merge ? p.dim : p.foreground))
    .when(!uncommitted, (el) => el.child(author(commit.author, avatar(commit.email), p)))
    .child(div().w(26).flex_shrink_0().text_right().text_xs().text_color(p.dim).child(ago(now, commit.time)));
}

function moreRow(p: Palette): Element {
  return div().h(ROW).px(12).flex().items_center().text_xs().text_color(p.accent).cursor_pointer().child("Show older commits");
}

export interface GraphActions {
  pick: (hash: string, cx: Context) => void;
  more: (cx: Context) => void;
}

/** A commit row was right-clicked; absent, rows have no menu. */
export type OpenMenu = (hash: string, cx: Context) => void;

export function graphList(view: HistoryView, p: Palette, scroll: VirtualListScrollHandle, actions: GraphActions, avatar: AvatarOf, menu?: OpenMenu): Element {
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
          i < view.rows.length ? row(view, i, width, now, p, avatar) : moreRow(p),
        ),
      )
        // Rows of a virtual list can't hold handlers: the list reports the row's key.
        .on_item_click((key, cx) => (key === MORE ? actions.more(cx) : actions.pick(key, cx)))
        .when(menu !== undefined, (el) => el.on_item_secondary_click((key, _e, cx) => (key === MORE || key === UNCOMMITTED ? undefined : menu?.(key, cx))))
        .track_scroll(scroll)
        .size_full(),
    )
    .child(Scrollbar.vertical(GRAPH_LIST).absolute().inset_0());
}
