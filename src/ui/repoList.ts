// The herd: every repo, grouped by folder, with its branch and what's going on in it.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { summarize } from "../core/git/status.ts";
import { groupRepos, type HerdRepo, type HerdState, type StatusResult } from "../core/herd.ts";
import { badge, ICONS, icon, type Palette } from "./style.ts";

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

function repoRow(repo: HerdRepo, state: HerdState, p: Palette, onPick: (path: string, cx: Context) => void): Element {
  const result = state.statuses[repo.path];
  const here = repo.path === state.selected;
  const branch = result?.status ? (result.status.branch ?? "detached") : result?.error ? "error" : "…";
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
        .text_color(p.dim)
        .child(icon(ICONS.branch, p.dim, 12))
        .child(div().truncate().child(branch))
        .when(Boolean(result?.error), (el) => el.tooltip(result?.error ?? "")),
    )
    .child(h_flex().gap(8).items_center().flex_shrink_0().text_xs().text_color(p.muted).children(statusBadges(result, p)));
}

export function repoList(state: HerdState, p: Palette, onPick: (path: string, cx: Context) => void): Element {
  const groups = groupRepos(state.repos);
  return v_flex()
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
        ...g.repos.map((r) => repoRow(r, state, p, onPick)),
      ]),
    );
}
