// The Review tab: what the branch changed since it split from main (one row per
// file, a click opens its diff in the viewer tab), and its pull request with the
// checks' results. Read-only: nothing here writes to git.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { BranchPr } from "../core/forge/index.ts";
import type { Review } from "../core/review.ts";
import { counts, fileRow } from "./details.ts";
import { textButton, type Palette } from "./style.ts";

export interface ReviewParts {
  /** Null on the main line itself, or while it is read. */
  review: Review | null;
  /** The base to compare with; null on main (or no main line). */
  base: string | null;
  pr: { pr: BranchPr | null; error: string | null; label: "PR" | "MR" } | null;
}

export interface ReviewActions {
  openFile: (path: string, cx: Context) => void;
  refresh: (cx: Context) => void;
}

function prLine(state: ReviewParts["pr"], p: Palette): Element {
  const row = h_flex().px(10).py(5).gap(8).items_center().flex_shrink_0().text_xs().border_b_1().border_color(p.border);
  if (state === null) return row.text_color(p.dim).child("Reading the review request…");
  if (state.error !== null) return row.text_color(p.removed).child(state.error);
  const pr = state.pr;
  if (pr === null) return row.text_color(p.dim).child(`No ${state.label} for this branch`);
  const { passed, failed, pending } = pr.checks;
  const total = passed + failed + pending;
  const checks = total === 0 ? "no checks" : `checks ${passed}✓${failed > 0 ? ` ${failed}✗` : ""}${pending > 0 ? ` ${pending}…` : ""}`;
  const state_ = pr.draft ? "DRAFT" : pr.state;
  const review = pr.review === "APPROVED" ? " · approved" : pr.review === "CHANGES_REQUESTED" ? " · changes requested" : "";
  return row
    .child(div().flex_shrink_0().text_color(p.accent).child(`${state.label === "MR" ? "!" : "#"}${pr.number}`))
    .child(div().flex_1().min_w_0().truncate().text_color(p.foreground).child(pr.title))
    .child(div().flex_shrink_0().text_color(p.dim).child(`${state_}${review}`))
    .child(div().flex_shrink_0().text_color(failed > 0 ? p.removed : pending > 0 ? p.changed : p.added).child(checks));
}

export function reviewPane(parts: ReviewParts, p: Palette, a: ReviewActions): Element {
  const pane = v_flex().flex_1().min_h_0();
  if (parts.base === null) return pane.child(div().p(14).text_color(p.dim).child("On the main line: nothing to review against it."));
  const r = parts.review;
  const added = r?.files.reduce((n, f) => n + f.added, 0) ?? 0;
  const deleted = r?.files.reduce((n, f) => n + f.deleted, 0) ?? 0;
  const title = r === null ? `Reading changes since ${parts.base}…` : r.error ?? `${r.files.length} files changed since ${parts.base}  +${added} −${deleted}`;
  return pane
    .child(
      h_flex()
        .h(28)
        .px(10)
        .gap(6)
        .items_center()
        .flex_shrink_0()
        .border_b_1()
        .border_color(p.border)
        .child(div().flex_1().min_w_0().truncate().text_xs().text_color(r?.error ? p.removed : p.muted).child(title))
        .child(textButton("review-refresh", "Refresh", p, a.refresh)),
    )
    .child(prLine(parts.pr, p))
    .child(
      v_flex()
        .id("gitdeck-review")
        .flex_1()
        .min_h_0()
        .overflow_y_scroll()
        .children((r?.files ?? []).map((f, i) => fileRow(`rv-${i}`, f.status, f.path, counts(f), p, (cx) => a.openFile(f.path, cx)))),
    );
}
