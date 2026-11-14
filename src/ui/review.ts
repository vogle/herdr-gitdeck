// The Review tab: what the branch changed since it split from main, code first,
// then tests, then the rest (folded at first); a click opens a file's diff in the
// viewer tab and marks it viewed. The pull request and its checks sit above.
// Read-only: nothing here writes to git.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { BranchPr } from "../core/forge/index.ts";
import { checksText, checksTone, prState } from "../core/forge/summary.ts";
import type { CommitFile } from "../core/git/show.ts";
import type { Review } from "../core/review.ts";
import { viewedCount, viewState, type Seen } from "../core/reviewed.ts";
import { groupReview, type ReviewGroup } from "../core/reviewOrder.ts";
import { kindIcon, lineCounts, statusLetter } from "./changeFiles.ts";
import { textButton, type Palette } from "./style.ts";

export interface ReviewParts {
  /** Null on the main line itself, or while it is read. */
  review: Review | null;
  /** The base to compare with; null on main (or no main line). */
  base: string | null;
  pr: { pr: BranchPr | null; error: string | null; label: "PR" | "MR" } | null;
  /** The files marked viewed in this repo, with the blob each had then. */
  seen: Seen;
  folded: ReadonlySet<ReviewGroup>;
  /** The feedback batch at the foot, or null with no notes. */
  feedback: Element | null;
}

export interface ReviewActions {
  openFile: (path: string, cx: Context) => void;
  refresh: (cx: Context) => void;
  toggleViewed: (path: string, cx: Context) => void;
  toggleGroup: (group: ReviewGroup, cx: Context) => void;
}

const GROUP_TITLE: Readonly<Record<ReviewGroup, string>> = { code: "Code", tests: "Tests", other: "Other" };

/** A check tone's color; "none" reads like a pass, quietly. */
export function toneColor(tone: ReturnType<typeof checksTone>, p: Palette): Palette["added"] {
  return tone === "failed" ? p.removed : tone === "pending" ? p.changed : tone === "passed" ? p.added : p.dim;
}

function prLine(state: ReviewParts["pr"], p: Palette): Element {
  const row = h_flex().px(10).py(5).gap(8).items_center().flex_shrink_0().text_xs().border_b_1().border_color(p.border);
  if (state === null) return row.text_color(p.dim).child("Reading the review request…");
  if (state.error !== null) return row.text_color(p.removed).child(state.error);
  const pr = state.pr;
  if (pr === null) return row.text_color(p.dim).child(`No ${state.label} for this branch`);
  return row
    .child(div().flex_shrink_0().text_color(p.accent).child(`${state.label === "MR" ? "!" : "#"}${pr.number}`))
    .child(div().flex_1().min_w_0().truncate().text_color(p.foreground).child(pr.title))
    .child(div().flex_shrink_0().text_color(p.dim).child(prState(pr)))
    .child(div().flex_shrink_0().text_color(toneColor(checksTone(pr.checks), p)).child(checksText(pr.checks)));
}

function groupHead(group: ReviewGroup, files: readonly CommitFile[], viewed: number, parts: ReviewParts, p: Palette, a: ReviewActions): Element {
  const closed = parts.folded.has(group);
  return h_flex()
    .id(`rv-group:${group}`)
    .mx(6)
    .mt(8)
    .mb(2)
    .pl(4)
    .pr(6)
    .h(24)
    .rounded(5)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => a.toggleGroup(group, cx))
    .child(div().w(14).flex_shrink_0().text_xs().text_color(p.dim).child(closed ? "▸" : "▾"))
    .child(div().flex_1().text_xs().font_semibold().text_color(p.muted).child(`${GROUP_TITLE[group].toUpperCase()}  ${files.length}`))
    .child(div().flex_shrink_0().text_xs().text_color(viewed === files.length ? p.added : p.dim).child(`${viewed} viewed`));
}

/** The viewed box: a click marks or unmarks, without opening the file. */
function viewBox(id: string, state: ReturnType<typeof viewState>, p: Palette, toggle: (cx: Context) => void): Element {
  return div()
    .id(id)
    .w(14)
    .h(14)
    .flex_shrink_0()
    .rounded(3)
    .border_1()
    .border_color(state === "viewed" ? p.accent : p.border)
    .when(state === "viewed", (el) => el.bg(p.accent).text_color(p.surface).text_xs().flex().items_center().justify_center().child("✓"))
    .cursor_pointer()
    .on_click((_e, cx) => {
      cx.stop_propagation();
      toggle(cx);
    });
}

/** A file row in the Changes tab's shape: kind icon, name, folder, counts, status letter; the viewed box in front. */
function reviewRow(f: CommitFile, i: number, parts: ReviewParts, blobs: ReadonlyMap<string, string>, p: Palette, a: ReviewActions): Element {
  const state = viewState(parts.seen, f.path, blobs.get(f.path));
  const cut = f.path.lastIndexOf("/");
  return h_flex()
    .id(`rv-${i}`)
    .h(24)
    .pl(10)
    .pr(10)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => a.openFile(f.path, cx))
    .child(viewBox(`rv-ck-${i}`, state, p, (cx) => a.toggleViewed(f.path, cx)))
    .child(kindIcon({ path: f.path, letter: f.status }, p))
    .child(
      h_flex()
        .flex_1()
        .min_w_0()
        .gap(6)
        .items_center()
        .child(
          div()
            .flex_shrink(1)
            .min_w_0()
            .truncate()
            .text_color(state === "viewed" ? p.dim : p.foreground)
            .when(f.status === "D", (el) => el.line_through().text_color(p.muted))
            .child(cut >= 0 ? f.path.slice(cut + 1) : f.path),
        )
        .when(cut >= 0, (el) => el.child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(f.path.slice(0, cut)))),
    )
    .when(state === "changed", (el) => el.child(div().flex_shrink_0().text_xs().text_color(p.changed).child("changed since viewed")))
    .child(lineCounts(f.binary ? undefined : { added: f.added, deleted: f.deleted, binary: false }, p))
    .child(statusLetter(f.status, p));
}

export function reviewPane(parts: ReviewParts, p: Palette, a: ReviewActions): Element {
  const pane = v_flex().flex_1().min_h_0();
  const foot = parts.feedback ? [parts.feedback] : [];
  if (parts.base === null) {
    return pane.child(div().flex_1().p(14).text_color(p.dim).child("On the main line: nothing to review against it.")).children(foot);
  }
  const r = parts.review;
  const files = r?.files ?? [];
  const blobs = r?.blobs ?? new Map<string, string>();
  const added = files.reduce((n, f) => n + f.added, 0);
  const deleted = files.reduce((n, f) => n + f.deleted, 0);
  const viewed = viewedCount(files.map((f) => f.path), parts.seen, blobs);
  const title =
    r === null ? `Reading changes since ${parts.base}…` : r.error ?? `${viewed} / ${files.length} viewed · since ${parts.base}  +${added} −${deleted}`;
  const groups = groupReview(files);
  let index = 0;
  const body = groups.flatMap((g) => {
    const rows = g.files.map((f) => ({ f, i: index++ }));
    const head = groupHead(g.group, g.files, viewedCount(g.files.map((f) => f.path), parts.seen, blobs), parts, p, a);
    return parts.folded.has(g.group) ? [head] : [head, ...rows.map(({ f, i }) => reviewRow(f, i, parts, blobs, p, a))];
  });
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
    .child(v_flex().id("gitdeck-review").flex_1().min_h_0().overflow_y_scroll().pb(8).children(body))
    .children(foot);
}
