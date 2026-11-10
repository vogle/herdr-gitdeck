// The 40px bar: gitdeck, the shown repo (a dropdown when there's a herd), its branch, refresh.
// The panel is hidden from the tab bar's GitDeck button, so it has no close of its own.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import { selectedRepo, type HerdState } from "../core/herd.ts";
import { statusBadges } from "./repoList.ts";
import { ICONS, icon, type Palette } from "./style.ts";

export interface HeaderActions {
  togglePicker: (cx: Context) => void;
  refresh: (cx: Context) => void;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function repoChip(state: HerdState, p: Palette, onToggle: (cx: Context) => void): Element {
  const many = state.repos.length > 1;
  return h_flex()
    .id("repo-chip")
    .gap(4)
    .px(6)
    .h(24)
    .items_center()
    .rounded(4)
    .min_w_0()
    .when(many, (el) =>
      el
        .cursor_pointer()
        .when(state.picking, (x) => x.bg(p.selected))
        .hover((x) => x.bg(p.hover))
        .on_click((_e, cx) => onToggle(cx)),
    )
    .child(div().truncate().font_medium().text_color(p.foreground).child(selectedRepo(state)?.name ?? "no repository"))
    .when(many, (el) => el.child(icon(ICONS.chevron, p.muted, 12)));
}

function branchLabel(branch: string, p: Palette): Element {
  return h_flex()
    .gap(4)
    .items_center()
    .min_w_0()
    .text_color(p.muted)
    .child(icon(ICONS.branch, p.muted, 12))
    .child(div().truncate().child(branch));
}

function refreshButton(p: Palette, onRefresh: (cx: Context) => void): Element {
  return div()
    .id("refresh")
    .p(4)
    .rounded(4)
    .cursor_pointer()
    .tooltip("Scan again")
    .hover((x) => x.bg(p.hover))
    .on_click((_e, cx) => onRefresh(cx))
    .child(icon(ICONS.refresh, p.muted, 14));
}

export function header(state: HerdState, busy: boolean, p: Palette, actions: HeaderActions): Element {
  const repo = selectedRepo(state);
  const result = repo ? state.statuses[repo.path] : undefined;
  const branch = result?.status ? (result.status.branch ?? "detached") : null;
  return h_flex()
    .id("header")
    .h(40)
    .px(10)
    .gap(8)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .child(icon(ICONS.herd, p.accent, 15))
    .child(repoChip(state, p, actions.togglePicker))
    .when(branch !== null, (el) => el.child(branchLabel(branch ?? "", p)))
    .child(h_flex().gap(8).items_center().text_xs().text_color(p.muted).children(statusBadges(result, p)))
    .child(div().flex_1())
    .when(busy, (el) => el.child(div().text_color(p.dim).frames(SPINNER, 90)))
    .child(refreshButton(p, actions.refresh));
}
