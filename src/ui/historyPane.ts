// The shown repo's history: a search bar, the refs sidebar, the graph, and
// the details of what is selected.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Input, type InputState, type VirtualListScrollHandle } from "gpui-base";
import type { RepoStatus } from "../core/git/status.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { changesPane, type ChangesActions, type ChangesParts } from "./changes.ts";
import { details, type DetailActions } from "./details.ts";
import type { InspectView } from "../core/inspect.ts";
import { graphList, type GraphActions } from "./graph.ts";
import { inspectPane } from "./inspect.ts";
import { commitBar, syncBar, type OpsActions, type OpsParts } from "./ops.ts";
import { sidebar } from "./sidebar.ts";
import { textButton, type Palette } from "./style.ts";

export interface HistoryActions extends GraphActions, DetailActions {
  toggleSidebar: (cx: Context) => void;
  jump: (hash: string, cx: Context) => void;
  reflog: (cx: Context) => void;
  stats: (cx: Context) => void;
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
  /** The staging panel, shown for the uncommitted row. */
  changes: { parts: ChangesParts; actions: ChangesActions } | null;
  /** Branch and sync actions; null while the repo awaits trust. */
  ops: { parts: OpsParts; actions: OpsActions } | null;
  /** Blame, a file's history or the reflog, in place of the details. */
  inspect: InspectView | null;
}

function toolbar(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const { view } = parts;
  const count = view.searching ? `${view.rows.length} found` : `${view.history?.commits.length ?? 0}${view.history?.limited ? "+" : ""} commits`;
  return h_flex()
    .h(32)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(textButton("toggle-sidebar", "Refs", p, actions.toggleSidebar, view.sidebar))
    .child(textButton("open-reflog", "Reflog", p, actions.reflog, parts.inspect?.kind === "reflog"))
    .child(textButton("open-stats", "Stats", p, actions.stats, parts.inspect?.kind === "stats"))
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

export function historyPane(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const below = parts.inspect
    ? inspectPane(parts.inspect, p, {
        jump: actions.jump,
        close: actions.closeInspect,
        openTreeFile: (i, cx) => actions.treeFile(i, cx),
        closeTreeFile: (cx) => actions.treeFile(null, cx),
      })
    : parts.view.selected === UNCOMMITTED && parts.changes
      ? changesPane(parts.changes.parts, p, parts.changes.actions)
      : details(parts.view, parts.status, p, actions);
  const commitActions = parts.ops && !parts.inspect && parts.view.selected !== UNCOMMITTED && parts.view.file === null ? commitBar(parts.ops.parts, p, parts.ops.actions) : null;
  const main = v_flex()
    .flex_1()
    .min_w_0()
    .min_h_0()
    .child(graphList(parts.view, p, parts.scroll, actions))
    .when(commitActions !== null, (el) => el.child(commitActions ?? div()))
    .when(below !== null, (el) => el.child(below ?? div()));
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(toolbar(parts, p, actions))
    .children(parts.ops ? syncBar(parts.ops.parts, p, parts.ops.actions) : [])
    .when(parts.untrusted !== null, (el) => el.child(trustBanner(parts.untrusted ?? [], p)))
    .child(
      h_flex()
        .flex_1()
        .min_h_0()
        .items_start()
        .when(parts.view.sidebar, (el) => el.child(sidebar(parts.view.history, p, actions.jump)))
        .child(main.h_full()),
    );
}
