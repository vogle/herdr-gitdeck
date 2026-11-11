// The shown repo as a side panel: a row of tabs (changes, history, branches,
// more), one list per tab that drills down to a commit, and the sync bar at the
// bottom. Diffs, blame and statistics open in the viewer tab instead; from
// WIDE_PX up the history tab shows the list and the commit side by side.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Input, type InputState, type VirtualListScrollHandle } from "gpui-base";
import type { RepoStatus } from "../core/git/status.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import type { InspectView } from "../core/inspect.ts";
import type { PanelTab } from "../core/panel.ts";
import { changesPane, type ChangesActions, type ChangesParts } from "./changes.ts";
import { details, type DetailActions } from "./details.ts";
import { graphList, type GraphActions } from "./graph.ts";
import { inspectPane } from "./inspect.ts";
import { commitBar, syncBar, type OpsActions, type OpsParts } from "./ops.ts";
import { reviewPane, type ReviewActions, type ReviewParts } from "./review.ts";
import { sidebar } from "./sidebar.ts";
import { textButton, type Palette } from "./style.ts";

export interface HistoryActions extends GraphActions, DetailActions {
  selectTab: (tab: PanelTab, cx: Context) => void;
  jump: (hash: string, cx: Context) => void;
  reflog: (cx: Context) => void;
  stats: (cx: Context) => void;
  prs: (cx: Context) => void;
  closeInspect: (cx: Context) => void;
  treeFile: (index: number | null, cx: Context) => void;
}

export interface HistoryParts {
  view: HistoryView;
  status: RepoStatus | null;
  /** The repo's own config names filter programs: no work-tree diffs. */
  untrusted: readonly string[] | null;
  search: InputState;
  scroll: VirtualListScrollHandle;
  /** The staging panel; null while the repo awaits trust. */
  changes: { parts: ChangesParts; actions: ChangesActions } | null;
  /** Branch and sync actions; null while the repo awaits trust. */
  ops: { parts: OpsParts; actions: OpsActions } | null;
  /** The reflog, pull requests or a commit's files, in place of the tab's list. */
  inspect: InspectView | null;
  tab: PanelTab;
  /** The panel is wide enough for two columns. */
  wide: boolean;
  /** The branch against main, for the Review tab. */
  review: { parts: ReviewParts; actions: ReviewActions };
}

const TAB_LABELS: Record<PanelTab, string> = { changes: "Changes", review: "Review", history: "History", branches: "Branches", more: "More" };

function tabRow(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const changed = parts.status?.entries.filter((e) => e.kind !== "ignored").length ?? 0;
  const label = (tab: PanelTab) => (tab === "changes" && changed > 0 ? `${TAB_LABELS[tab]} ${changed}` : TAB_LABELS[tab]);
  return h_flex()
    .h(32)
    .px(6)
    .gap(2)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .children((Object.keys(TAB_LABELS) as PanelTab[]).map((tab) =>
      textButton(`tab-${tab}`, label(tab), p, (cx) => actions.selectTab(tab, cx), parts.tab === tab),
    ));
}

function trustBanner(filters: readonly string[], p: Palette): Element {
  return div()
    .px(10)
    .py(4)
    .flex_shrink_0()
    .text_xs()
    .text_color(p.changed)
    .bg(p.raised)
    .child(`Work-tree changes not read: this repo's own config names ${filters.join(", ")}. History is safe to show.`);
}

function note(text: string, p: Palette): Element {
  return v_flex().flex_1().p(14).text_color(p.dim).child(text);
}

function searchRow(parts: HistoryParts, p: Palette): Element {
  const { view } = parts;
  const count = view.searching ? `${view.rows.length} found` : `${view.history?.commits.length ?? 0}${view.history?.limited ? "+" : ""}`;
  return h_flex()
    .h(32)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(
      div()
        .flex_1()
        .min_w_0()
        .h(22)
        .px(6)
        .rounded(4)
        .border_1()
        .border_color(p.border)
        .bg(p.chrome)
        .child(Input.new(parts.search).size_full().text_xs().text_color(p.foreground)),
    )
    .child(div().flex_shrink_0().text_xs().text_color(p.dim).child(count));
}

/** The commit list, or (narrow) the selected commit in its place, or (wide) both. */
function historyTab(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const { view } = parts;
  const list = v_flex().flex_1().min_w_0().min_h_0().child(searchRow(parts, p)).child(graphList(view, p, parts.scroll, actions));
  const open = view.selected !== null && view.selected !== UNCOMMITTED;
  if (!open) return list;
  const commitActions = parts.ops ? commitBar(parts.ops.parts, p, parts.ops.actions) : null;
  const detail = v_flex()
    .flex_1()
    .min_w_0()
    .min_h_0()
    .when(commitActions !== null, (el) => el.child(commitActions ?? div()))
    .child(details(view, parts.status, p, actions) ?? div());
  if (!parts.wide) return detail;
  return h_flex().flex_1().min_h_0().items_start().child(list.h_full().border_r_1().border_color(p.border)).child(detail.h_full());
}

function moreTab(p: Palette, actions: HistoryActions): Element {
  const row = (id: string, label: string, hint: string, onClick: (cx: Context) => void) =>
    v_flex()
      .id(id)
      .px(12)
      .py(8)
      .gap(2)
      .cursor_pointer()
      .border_b_1()
      .border_color(p.border)
      .hover((el) => el.bg(p.hover))
      .on_click((_e, cx) => onClick(cx))
      .child(div().child(label))
      .child(div().text_xs().text_color(p.dim).child(hint));
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(row("more-reflog", "Reflog", "Where HEAD has been", actions.reflog))
    .child(row("more-prs", "Pull requests", "GitHub, via gh (read-only)", actions.prs))
    .child(row("more-stats", "Statistics", "Authors and commits per month, in a tab", actions.stats));
}

function tabBody(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  if (parts.inspect) {
    return inspectPane(parts.inspect, p, {
      jump: actions.jump,
      close: actions.closeInspect,
      openTreeFile: (i, cx) => actions.treeFile(i, cx),
      closeTreeFile: (cx) => actions.treeFile(null, cx),
    });
  }
  if (parts.tab === "changes") {
    if (parts.changes) return changesPane(parts.changes.parts, p, parts.changes.actions);
    return note(parts.untrusted ? "Work-tree changes are not read for this repo." : "Reading changes…", p);
  }
  if (parts.tab === "review") return reviewPane(parts.review.parts, p, parts.review.actions);
  if (parts.tab === "branches") return h_flex().flex_1().min_h_0().child(sidebar(parts.view.history, p, actions.jump, true));
  if (parts.tab === "more") return moreTab(p, actions);
  return historyTab(parts, p, actions);
}

export function historyPane(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(tabRow(parts, p, actions))
    .when(parts.untrusted !== null, (el) => el.child(trustBanner(parts.untrusted ?? [], p)))
    .child(v_flex().flex_1().min_h_0().child(tabBody(parts, p, actions)))
    .when(parts.ops !== null, (el) =>
      el.child(v_flex().flex_shrink_0().border_t_1().border_color(p.border).children(parts.ops ? syncBar(parts.ops.parts, p, parts.ops.actions) : [])),
    );
}
