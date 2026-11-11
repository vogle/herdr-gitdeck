// The 40px bar: gitdeck, the shown repo (a dropdown when there's a herd), its branch,
// how far it is from main, the coding agents working in it, refresh.
// The panel is hidden from the tab bar's GitDeck button, so it has no close of its own.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import { selectedRepo, type HerdState } from "../core/herd.ts";
import type { AgentChip, AgentStatus } from "../core/repoAgents.ts";
import type { Compare } from "../core/review.ts";
import { statusBadges } from "./repoList.ts";
import { ICONS, icon, type Palette } from "./style.ts";

export interface HeaderFacts {
  /** The agents whose terminal is in the shown repo. */
  agents: readonly AgentChip[];
  /** The branch against main; null on main itself. */
  compare: Compare | null;
}

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
    .flex_shrink_0()
    .child(div().max_w(160).truncate().font_medium().text_color(p.foreground).child(selectedRepo(state)?.name ?? "no repository"))
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

function compareLabel(c: Compare, p: Palette): Element {
  const counts = c.ahead === 0 && c.behind === 0 ? "even" : `${c.ahead > 0 ? `↑${c.ahead}` : ""}${c.behind > 0 ? ` ↓${c.behind}` : ""}`.trim();
  return div()
    .id("vs-base")
    .flex_shrink_0()
    .text_xs()
    .text_color(p.dim)
    .tooltip(`Against ${c.base}: ${c.ahead} commits not on it, ${c.behind} on it not here`)
    .child(`${c.base.replace(/^origin\//, "")} ${counts}`);
}

function agentColor(status: AgentStatus, p: Palette): Palette["added"] {
  return status === "working" ? p.changed : status === "blocked" ? p.removed : status === "done" ? p.added : p.dim;
}

/** A dot per agent; the first one also says its state, and gives way first when narrow. */
function agentChip(a: AgentChip, i: number, p: Palette): Element {
  return h_flex()
    .id(`agent-${i}`)
    .gap(4)
    .items_center()
    .min_w_0()
    .text_xs()
    .text_color(p.muted)
    .tooltip(a.text)
    .child(div().flex_shrink_0().w(7).h(7).rounded(4).bg(agentColor(a.status, p)))
    .when(i === 0, (el) => el.child(div().truncate().child(a.text)));
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

export function header(state: HerdState, busy: boolean, p: Palette, actions: HeaderActions, facts: HeaderFacts): Element {
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
    .when(facts.compare !== null, (el) => el.child(compareLabel(facts.compare as Compare, p)))
    .child(div().flex_1())
    .child(h_flex().gap(6).items_center().min_w_0().children(facts.agents.slice(0, 3).map((a, i) => agentChip(a, i, p))))
    .when(busy, (el) => el.child(div().text_color(p.dim).frames(SPINNER, 90)))
    .child(refreshButton(p, actions.refresh));
}
