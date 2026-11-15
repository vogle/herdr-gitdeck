// The strip under the header for the shown branch's open PR or MR: its number,
// title, state and checks. A click opens the Review tab (the branch's files and
// checks, read locally); the ↗ button opens the PR's page in the browser, where
// comments, approvals and merging stay.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { BranchPr, ForgeKind } from "../core/forge/index.ts";
import { checksText, checksTone, prNumber, prState } from "../core/forge/summary.ts";
import { toneColor } from "./review.ts";
import { ICONS, icon, textButton, type Palette } from "./style.ts";

export interface PrBarActions {
  review: (cx: Context) => void;
  open: (url: string, cx: Context) => void;
}

function openButton(url: string, label: "PR" | "MR", p: Palette, a: PrBarActions): Element {
  return div()
    .id("pr-open")
    .flex_shrink_0()
    .p(3)
    .rounded(4)
    .cursor_pointer()
    .tooltip(`Open the ${label} in the browser`)
    .hover((x) => x.bg(p.hover))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      a.open(url, cx);
    })
    .child(icon(ICONS.external, p.muted, 13));
}

export function prBar(pr: BranchPr, label: "PR" | "MR", p: Palette, a: PrBarActions): Element {
  return h_flex()
    .id("pr-bar")
    .px(12)
    .h(28)
    .gap(8)
    .items_center()
    .flex_shrink_0()
    .text_xs()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .cursor_pointer()
    .hover((x) => x.bg(p.hover))
    .tooltip("Show the branch's changes and checks")
    .on_click((_e, cx) => a.review(cx))
    .child(icon(ICONS.pr, p.added, 13))
    .child(div().flex_shrink_0().font_medium().text_color(p.foreground).child(prNumber(pr, label)))
    .child(div().flex_1().min_w_0().truncate().text_color(p.muted).child(pr.title))
    .child(div().flex_shrink_0().text_color(p.dim).child(prState(pr)))
    .child(div().flex_shrink_0().text_color(toneColor(checksTone(pr.checks), p)).child(checksText(pr.checks)))
    .child(openButton(pr.url, label, p, a));
}

/**
 * In the PR bar's place when origin is on a host gitdeck can't tell (no CLI, or
 * both, signed in to it): the question, where it's seen without opening a tab.
 */
export function forgeQuestion(host: string, p: Palette, choose: (kind: ForgeKind, cx: Context) => void): Element {
  return h_flex()
    .id("forge-question")
    .px(12)
    .h(28)
    .gap(8)
    .items_center()
    .flex_shrink_0()
    .text_xs()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .child(icon(ICONS.pr, p.dim, 13))
    .child(div().flex_1().min_w_0().truncate().text_color(p.muted).child(`origin is on ${host}: GitLab or GitHub? PRs and checks show once it's named`))
    .child(textButton("forge-q-gitlab", "GitLab", p, (cx) => choose("gitlab", cx)))
    .child(textButton("forge-q-github", "GitHub", p, (cx) => choose("github", cx)));
}

/** The row when there's no PR to show: being read, none, or why it can't be read. A click reads it again. */
export function prNote(text: string, error: boolean, p: Palette, again: ((cx: Context) => void) | null): Element {
  return h_flex()
    .id("pr-note")
    .px(12)
    .h(28)
    .gap(8)
    .items_center()
    .flex_shrink_0()
    .text_xs()
    .border_b_1()
    .border_color(p.border)
    .bg(p.chrome)
    .when(again !== null, (el) =>
      el
        .cursor_pointer()
        .hover((x) => x.bg(p.hover))
        .tooltip("Read it again")
        .on_click((_e, cx) => again?.(cx)),
    )
    .child(icon(ICONS.pr, error ? p.removed : p.dim, 13))
    .child(div().flex_1().min_w_0().truncate().text_color(error ? p.removed : p.dim).child(text));
}
