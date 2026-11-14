// The bar on top. First line, where you are: the shown repo (a dropdown when
// there's a herd), its branch and how far it is from main, refresh. Second line,
// who is at work: the coding agents in the repo first (the busiest as a badge with
// how long it has been so), then what needs doing: conflicts, and the remote work
// (pull, push or publish). The second line goes away when it has nothing to say.
// File counts live on the Changes tab, not here.
// The panel is hidden from the tab bar's GitDeck button, so it has no close of its own.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { selectedRepo, type HerdState } from "../core/herd.ts";
import type { AgentChip } from "../core/repoAgents.ts";
import type { Compare } from "../core/review.ts";
import type { SyncChip } from "../core/syncChips.ts";
import { ago } from "../core/time.ts";
import { agentBadge, agentColor, ICONS, icon, textButton, type Palette } from "./style.ts";

export interface HeaderFacts {
  /** The agents whose terminal is in the shown repo. */
  agents: readonly AgentChip[];
  /** The branch against main; null on main itself. */
  compare: Compare | null;
  /** Pull and push for the shown repo; null where its status is not trusted. */
  sync: HeaderSync | null;
  /** "! 2 conflicts", or null. */
  conflicts: string | null;
  /** Now, ms since the epoch, for how long an agent has been in its state. */
  now: number;
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
    .child(`→ ${c.base.replace(/^origin\//, "")} ${counts}`);
}

/**
 * A dot per agent; the first one also says its state and how long it has been so.
 * That first one is a badge in its state's color unless the agent is idle.
 */
function agentChip(a: AgentChip, i: number, p: Palette, now: number): Element {
  const badge = i === 0 ? agentBadge(a.status, p) : null;
  const age = a.since === null ? "" : ago(Math.floor(now / 1000), Math.floor(a.since / 1000));
  return h_flex()
    .id(`agent-${i}`)
    .gap(4)
    .items_center()
    .min_w_0()
    .text_xs()
    .text_color(badge?.fg ?? p.muted)
    .tooltip(a.text)
    .when(badge !== null, (el) => el.px(6).py(1).rounded(8).bg(badge?.bg ?? p.surface).font_semibold())
    .child(div().flex_shrink_0().w(7).h(7).rounded(4).bg(badge?.dot ?? agentColor(a.status, p)))
    .when(i === 0, (el) => el.child(div().truncate().child(a.text)))
    .when(i === 0 && age !== "", (el) => el.child(div().flex_shrink_0().font_normal().opacity(0.75).child(`· ${age}`)));
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

/** Where you are: the repo, its branch (it gives way first) and how far from main, with refresh at the end. */
function whereRow(state: HerdState, branch: string | null, busy: boolean, p: Palette, actions: HeaderActions, compare: Compare | null): Element {
  return h_flex()
    .h(28)
    .gap(8)
    .items_center()
    .child(icon(ICONS.herd, p.accent, 15))
    .child(repoChip(state, p, actions.togglePicker))
    .when(branch !== null, (el) => el.child(branchLabel(branch ?? "", p)))
    .when(compare !== null, (el) => el.child(compareLabel(compare as Compare, p)))
    .child(div().flex_1())
    .when(busy, (el) => el.child(div().text_color(p.dim).frames(SPINNER, 90)))
    .child(refreshButton(p, actions.refresh));
}

/** Who is at work: the agents on the left; conflicts and remote work on the right. Null when there's none of it. */
function stateRow(p: Palette, facts: HeaderFacts): Element | null {
  const chips = facts.sync?.chips ?? [];
  if (facts.agents.length === 0 && facts.conflicts === null && chips.length === 0) return null;
  return h_flex()
    .h(22)
    .gap(8)
    .items_center()
    .child(h_flex().gap(6).items_center().min_w_0().children(facts.agents.slice(0, 3).map((a, i) => agentChip(a, i, p, facts.now))))
    .child(div().flex_1())
    .when(facts.conflicts !== null, (el) =>
      el.child(div().flex_shrink_0().text_xs().font_semibold().text_color(p.removed).child(facts.conflicts ?? "")),
    )
    .children(facts.sync ? chips.map((c) => syncChip(c, facts.sync as HeaderSync, p)) : []);
}

export function header(state: HerdState, busy: boolean, p: Palette, actions: HeaderActions, facts: HeaderFacts): Element {
  const repo = selectedRepo(state);
  const result = repo ? state.statuses[repo.path] : undefined;
  const branch = result?.status ? (result.status.branch ?? "detached") : null;
  const second = stateRow(p, facts);
  return v_flex()
    .id("header")
    .px(10)
    .pt(4)
    .pb(6)
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .child(whereRow(state, branch, busy, p, actions, facts.compare))
    .when(second !== null, (el) => el.child(second as Element));
}
