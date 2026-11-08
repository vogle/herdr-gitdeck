// The shown repo's history: a search bar, the refs sidebar, the graph, and
// the details of what is selected.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Input, type InputState, type VirtualListScrollHandle } from "gpui-base";
import type { RepoStatus } from "../core/git/status.ts";
import type { HistoryView } from "../core/historyView.ts";
import { details, type DetailActions } from "./details.ts";
import { graphList, type GraphActions } from "./graph.ts";
import { sidebar } from "./sidebar.ts";
import { textButton, type Palette } from "./style.ts";

export interface HistoryActions extends GraphActions, DetailActions {
  toggleSidebar: (cx: Context) => void;
  jump: (hash: string, cx: Context) => void;
}

export interface HistoryParts {
  view: HistoryView;
  status: RepoStatus | null;
  /** The repo's own config names filter programs: no work-tree diffs. */
  untrusted: readonly string[] | null;
  search: InputState;
  scroll: VirtualListScrollHandle;
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
  const below = details(parts.view, parts.status, p, actions);
  const main = v_flex()
    .flex_1()
    .min_w_0()
    .min_h_0()
    .child(graphList(parts.view, p, parts.scroll, actions))
    .when(below !== null, (el) => el.child(below ?? div()));
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(toolbar(parts, p, actions))
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
