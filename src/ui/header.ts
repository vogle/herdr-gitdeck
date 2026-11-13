// The two-line bar. First line, where you are: the shown repo (a dropdown when
// there's a herd), its branch, refresh. Second line, how it stands: the counts,
// how far it is from main, the remote work there is to do (pull, push or
// publish, shown only when there is some), and the coding agents working in it,
// which keep their words rather than shrink to a few letters.
// The panel is hidden from the tab bar's GitDeck button, so it has no close of its own.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { selectedRepo, type HerdState } from "../core/herd.ts";
import type { AgentChip } from "../core/repoAgents.ts";
import type { Compare } from "../core/review.ts";
import type { SyncChip } from "../core/syncChips.ts";
import { statusBadges } from "./repoList.ts";
import { agentColor, ICONS, icon, textButton, type Palette } from "./style.ts";

export interface HeaderFacts {
  /** The agents whose terminal is in the shown repo. */
  agents: readonly AgentChip[];
  /** The branch against main; null on main itself. */
  compare: Compare | null;
  /** Pull and push for the shown repo; null where its status is not trusted. */
  sync: HeaderSync | null;
}

export interface HeaderSync {
  chips: readonly SyncChip[];
  /** Another git action is running: the chips wait. */
  busy: boolean;
  run: (kind: SyncChip["kind"], cx: Context) => void;
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

function syncChip(c: SyncChip, sync: HeaderSync, p: Palette): Element {
  return div()
    .id(`sync-${c.kind}`)
    .flex_shrink_0()
    .tooltip(c.tip)
    .child(textButton(`sync-btn-${c.kind}`, c.label, p, (cx) => sync.run(c.kind, cx), true, !sync.busy));
}

function refreshButton(p: Palette, onRefresh: (cx: Context) => void): Element {
  return div()
    .id("refresh")
    .p(4)
    .rounded(4)
    .cursor_pointer()
    .tooltip("Fetch and scan again")
    .hover((x) => x.bg(p.hover))
    .on_click((_e, cx) => onRefresh(cx))
    .child(icon(ICONS.refresh, p.muted, 14));
}

/** Where you are: the repo and its whole branch name, with refresh at the end. */
function whereRow(state: HerdState, branch: string | null, busy: boolean, p: Palette, actions: HeaderActions): Element {
  return h_flex()
    .h(28)
    .gap(8)
    .items_center()
    .child(icon(ICONS.herd, p.accent, 15))
    .child(repoChip(state, p, actions.togglePicker))
    .when(branch !== null, (el) => el.child(branchLabel(branch ?? "", p)))
    .child(div().flex_1())
    .when(busy, (el) => el.child(div().text_color(p.dim).frames(SPINNER, 90)))
    .child(refreshButton(p, actions.refresh));
}

/** How it stands: the counts and main on the left, the agents working in it on the right. */
function stateRow(result: HerdState["statuses"][string] | undefined, p: Palette, facts: HeaderFacts): Element {
  return h_flex()
    .h(20)
    .gap(8)
    .items_center()
    .child(h_flex().gap(8).items_center().flex_shrink_0().text_xs().text_color(p.muted).children(statusBadges(result, p)))
    .when(facts.compare !== null, (el) => el.child(compareLabel(facts.compare as Compare, p)))
    .children(facts.sync ? facts.sync.chips.map((c) => syncChip(c, facts.sync as HeaderSync, p)) : [])
    .child(div().flex_1())
    .child(h_flex().gap(6).items_center().min_w_0().children(facts.agents.slice(0, 3).map((a, i) => agentChip(a, i, p))));
}

export function header(state: HerdState, busy: boolean, p: Palette, actions: HeaderActions, facts: HeaderFacts): Element {
  const repo = selectedRepo(state);
  const result = repo ? state.statuses[repo.path] : undefined;
  const branch = result?.status ? (result.status.branch ?? "detached") : null;
  return v_flex()
    .id("header")
    .px(10)
    .pt(4)
    .pb(6)
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .child(whereRow(state, branch, busy, p, actions))
    .child(stateRow(result, p, facts));
}
