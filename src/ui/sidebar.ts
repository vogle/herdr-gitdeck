// Beside the graph: branches, remote branches, tags and stashes. A click selects
// the commit it points at.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Stash } from "../core/git/log.ts";
import type { Ref } from "../core/git/refs.ts";
import type { History } from "../core/history.ts";
import type { Palette } from "./style.ts";

const MAX_PER_SECTION = 200;

function item(id: string, text: string, extra: string, current: boolean, p: Palette, onPick: (cx: Context) => void): Element {
  return h_flex()
    .id(id)
    .h(22)
    .px(10)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => onPick(cx))
    .child(div().flex_1().min_w_0().truncate().text_color(current ? p.foreground : p.muted).when(current, (el) => el.font_medium()).child(text))
    .when(extra !== "", (el) => el.child(div().flex_shrink_0().text_xs().text_color(p.info).child(extra)));
}

function section(title: string, items: Element[], total: number, p: Palette): Element[] {
  if (total === 0) return [];
  const more = total > items.length ? [div().px(10).text_xs().text_color(p.dim).child(`… ${total - items.length} more`)] : [];
  return [div().px(10).pt(10).pb(2).text_xs().text_color(p.dim).child(`${title} ${total}`), ...items, ...more];
}

function track(r: Ref): string {
  return [r.ahead > 0 ? `↑${r.ahead}` : "", r.behind > 0 ? `↓${r.behind}` : ""].filter(Boolean).join(" ");
}

/** `full`: fills its column (the panel's Branches tab) instead of a fixed-width rail. */
export function sidebar(history: History | null, p: Palette, onPick: (hash: string, cx: Context) => void, full = false): Element {
  const refs = history?.refs ?? [];
  const of = (kind: Ref["kind"]) => refs.filter((r) => r.kind === kind);
  const refItems = (list: readonly Ref[], prefix: string) =>
    list.slice(0, MAX_PER_SECTION).map((r) => item(`${prefix}:${r.full}`, r.name, r.kind === "branch" ? track(r) : "", r.current, p, (cx) => onPick(r.hash, cx)));
  const stashes: readonly Stash[] = history?.stashes ?? [];
  const stashItems = stashes.slice(0, MAX_PER_SECTION).map((s) => item(`st:${s.name}`, `${s.name}  ${s.subject}`, "", false, p, (cx) => onPick(s.hash, cx)));
  const [branches, remotes, tags] = [of("branch"), of("remote"), of("tag")];
  return v_flex()
    .id("githerd-sidebar")
    .when(full, (el) => el.flex_1().min_w_0())
    .when(!full, (el) => el.w(190).flex_shrink_0())
    .h_full()
    .overflow_y_scrollbar()
    .pb(8)
    .border_r_1()
    .border_color(p.border)
    .bg(p.chrome)
    .children([
      ...section("Branches", refItems(branches, "b"), branches.length, p),
      ...section("Remotes", refItems(remotes, "r"), remotes.length, p),
      ...section("Tags", refItems(tags, "t"), tags.length, p),
      ...section("Stashes", stashItems, stashes.length, p),
    ]);
}
