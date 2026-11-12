// The herd: every repo, grouped by folder, with its branch and what's going on in it.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { summarize } from "../core/git/status.ts";
import { groupRepos, type HerdRepo, type HerdState, type StatusResult } from "../core/herd.ts";
import { reposShown, type AgentChip } from "../core/repoAgents.ts";
import { agentColor, badge, ICONS, icon, textButton, type Palette } from "./style.ts";

export interface HerdAgents {
  /** The agents of each repo, keyed by path. */
  byRepo: Readonly<Record<string, readonly AgentChip[]>>;
  /** List only the repos with agents (and the shown one). */
  only: boolean;
  toggle: (cx: Context) => void;
}

/** One dot per agent (up to three), its state in the tooltip. */
function agentDots(chips: readonly AgentChip[], p: Palette): Element[] {
  return chips.slice(0, 3).map((a, i) =>
    div().id(`dot-${i}`).w(7).h(7).rounded(4).flex_shrink_0().bg(agentColor(a.status, p)).tooltip(a.text),
  );
}

export function statusBadges(result: StatusResult | undefined, p: Palette): Element[] {
  const status = result?.status;
  if (!status) return [];
  const s = summarize(status);
  return [
    ...badge("!", s.conflicts, p.removed, "conflicts"),
    ...badge("●", s.staged, p.added, "staged"),
    ...badge("●", s.unstaged, p.changed, "changed, not staged"),
    ...badge("?", s.untracked, p.dim, "untracked"),
    ...badge("↑", status.ahead, p.info, "commits to push"),
    ...badge("↓", status.behind, p.info, "commits to pull"),
  ];
}

function repoRow(repo: HerdRepo, state: HerdState, p: Palette, onPick: (path: string, cx: Context) => void, chips: readonly AgentChip[]): Element {
  const result = state.statuses[repo.path];
  const here = repo.path === state.selected;
  const untrusted = Boolean(result?.untrusted);
  const branch = result?.status ? (result.status.branch ?? "detached") : untrusted ? "needs trust" : result?.error ? "error" : "…";
  const tip = untrusted ? `Not read: this repo's own config names ${result?.untrusted?.join(", ")}` : (result?.error ?? "");
  return h_flex()
    .id(`repo:${repo.path}`)
    .h(30)
    .px(10)
    .gap(8)
    .items_center()
    .rounded(4)
    .cursor_pointer()
    .when(here, (el) => el.bg(p.selected))
    .hover((el) => el.bg(here ? p.selected : p.hover))
    .on_click((_e, cx) => onPick(repo.path, cx))
    .when(chips.length > 0, (el) => el.child(h_flex().gap(3).items_center().flex_shrink_0().children(agentDots(chips, p))))
    .child(
      div()
        .min_w_0()
        .truncate()
        .text_color(here ? p.foreground : p.muted)
        .when(repo.isRoot, (el) => el.font_medium())
        .child(repo.name),
    )
    .child(
      h_flex()
        .gap(4)
        .items_center()
        .min_w_0()
        .flex_1()
        .text_color(untrusted ? p.changed : p.dim)
        .child(icon(ICONS.branch, p.dim, 12))
        .child(div().truncate().child(branch))
        .when(tip !== "", (el) => el.tooltip(tip)),
    )
    .child(h_flex().gap(8).items_center().flex_shrink_0().text_xs().text_color(p.muted).children(statusBadges(result, p)));
}

function filterRow(state: HerdState, agents: HerdAgents, p: Palette): Element {
  const busy = state.repos.filter((r) => (agents.byRepo[r.path]?.length ?? 0) > 0).length;
  return h_flex()
    .h(28)
    .px(10)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .text_xs()
    .border_b_1()
    .border_color(p.border)
    .child(div().flex_1().text_color(p.dim).child(`${busy} of ${state.repos.length} repos have agents`))
    .child(textButton("herd-filter", agents.only ? "Show all" : "With agents", p, agents.toggle, agents.only));
}

export function repoList(state: HerdState, p: Palette, onPick: (path: string, cx: Context) => void, agents: HerdAgents): Element {
  const groups = groupRepos(reposShown(state.repos, agents.byRepo, agents.only, state.selected));
  const list = v_flex()
    .id("repo-list")
    .flex_1()
    .min_h_0()
    .overflow_y_scrollbar()
    .p(6)
    .gap(1)
    .children(
      groups.flatMap((g) => [
        div()
          .px(10)
          .pt(8)
          .pb(2)
          .text_xs()
          .text_color(p.dim)
          .child(g.group === "" ? "./" : `${g.group}/`),
        ...g.repos.map((r) => repoRow(r, state, p, onPick, agents.byRepo[r.path] ?? [])),
      ]),
    );
  return v_flex().flex_1().min_h_0().child(filterRow(state, agents, p)).child(list);
}
