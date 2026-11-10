// Branch and sync controls: a sync bar (fetch, pull, push, stash), the
// operation under way with continue/abort, and the selected commit's actions.

import type { FlowKind } from "../core/flow.ts";
import { planProblem, type RebasePlan } from "../core/rebase.ts";
import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Input, type InputState } from "gpui-base";
import type { ActionKind, CommitAction, OpsView } from "../core/opsView.ts";
import type { Operation } from "../core/ops.ts";
import { textButton, type Palette } from "./style.ts";

export interface OpsActions {
  fetch: (cx: Context) => void;
  pull: (cx: Context) => void;
  push: (cx: Context) => void;
  stash: (cx: Context) => void;
  sequence: (step: "continue" | "abort" | "skip", cx: Context) => void;
  commitAction: (action: CommitAction, cx: Context) => void;
  /** Reset: the mode picked after the first click. */
  reset: (mode: "soft" | "mixed" | "hard", cx: Context) => void;
  createName: (cx: Context) => void;
  cancelName: (cx: Context) => void;
  dismiss: (cx: Context) => void;
  /** Starts naming a git-flow branch. */
  startFlow: (kind: FlowKind, cx: Context) => void;
  /** The interactive rebase editor. */
  cycleStep: (index: number, cx: Context) => void;
  moveStep: (index: number, by: -1 | 1, cx: Context) => void;
  runPlan: (cx: Context) => void;
  cancelPlan: (cx: Context) => void;
}

export interface OpsParts {
  view: OpsView;
  ahead: number;
  behind: number;
  /** The selected commit's actions; null for none or the uncommitted row. */
  commit: CommitAction[] | null;
  name: InputState;
  /** The git-flow branches this repo can start (it has develop, main or master). */
  flow: readonly FlowKind[];
}

/** The actions that need a second click, and what that click says. */
const CONFIRM: Partial<Record<ActionKind, string>> = {
  rebase: "Rebase?",
  "delete-branch": "Delete?",
  "stash-drop": "Drop?",
  "stash-pop": "Pop?",
};

const LABEL: Record<ActionKind, string> = {
  "checkout-commit": "Check out",
  "checkout-branch": "Switch to",
  "checkout-remote": "Track",
  branch: "New branch",
  tag: "New tag",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  merge: "Merge",
  rebase: "Rebase onto",
  "edit-after": "Edit commits after this",
  reset: "Reset to here",
  "delete-branch": "Delete",
  "stash-apply": "Apply",
  "stash-pop": "Pop",
  "stash-drop": "Drop",
};

export const actionKey = (a: CommitAction): string => `${a.kind}:${a.ref ?? ""}`;

function operationBanner(op: Operation, p: Palette, a: OpsActions): Element {
  const name = op === "cherry-pick" ? "Cherry-pick" : op[0]?.toUpperCase() + op.slice(1);
  return h_flex()
    .px(10)
    .py(4)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .bg(p.raised)
    .child(div().flex_1().min_w_0().text_xs().text_color(p.changed).child(`${name} under way: resolve conflicts, stage them, then Continue.`))
    .child(textButton("op-continue", "Continue", p, (cx) => a.sequence("continue", cx), true))
    .when(op !== "merge", (el) => el.child(textButton("op-skip", "Skip", p, (cx) => a.sequence("skip", cx))))
    .child(textButton("op-abort", "Abort", p, (cx) => a.sequence("abort", cx)));
}

/** The sync bar, plus the operation banner and the last result. */
export function syncBar(parts: OpsParts, p: Palette, a: OpsActions): Element[] {
  const { view } = parts;
  const bar = h_flex()
    .h(28)
    .px(8)
    .gap(4)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(textButton("op-fetch", "Fetch", p, a.fetch))
    .child(textButton("op-pull", parts.behind > 0 ? `Pull ↓${parts.behind}` : "Pull", p, a.pull))
    .child(textButton("op-push", parts.ahead > 0 ? `Push ↑${parts.ahead}` : "Push", p, a.push))
    .child(textButton("op-stash", "Stash", p, a.stash))
    .children(parts.flow.map((k) => textButton(`flow-${k}`, `+ ${k}`, p, (cx) => a.startFlow(k, cx))))
    .child(div().flex_1())
    .when(view.busy !== null, (el) => el.child(div().text_xs().text_color(p.dim).child(`${view.busy}…`)));
  const message = view.error ?? view.notice;
  const result =
    message === null
      ? null
      : h_flex()
          .px(10)
          .py(3)
          .gap(6)
          .items_center()
          .flex_shrink_0()
          .bg(p.raised)
          .child(div().flex_1().min_w_0().text_xs().text_color(view.error ? p.removed : p.added).child(message))
          .child(textButton("op-dismiss", "×", p, a.dismiss));
  const flowNaming = view.naming && view.naming.kind !== "branch" && view.naming.kind !== "tag" ? namingRow(parts, p, a) : null;
  return [bar, ...(flowNaming ? [flowNaming] : []), ...(view.operation ? [operationBanner(view.operation, p, a)] : []), ...(result ? [result] : [])];
}

function namingRow(parts: OpsParts, p: Palette, a: OpsActions): Element {
  const kind = parts.view.naming?.kind ?? "branch";
  return h_flex()
    .h(30)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_t_1()
    .border_color(p.border)
    .child(div().text_xs().text_color(p.dim).child(kind === "branch" ? "New branch:" : kind === "tag" ? "New tag:" : `New ${kind} from ${parts.view.naming?.at ?? ""}: ${kind}/`))
    .child(div().flex_1().min_w_0().h(22).px(6).rounded(4).border_1().border_color(p.border).bg(p.chrome).child(Input.new(parts.name).size_full().text_xs()))
    .child(textButton("name-create", kind === "tag" ? "Create" : "Create and switch", p, a.createName, true))
    .child(textButton("name-cancel", "Cancel", p, a.cancelName));
}

/** The selected commit's actions, as a wrapping row of buttons. */
const STEP_COLOR = { pick: "foreground", squash: "info", fixup: "info", drop: "removed" } as const;

/** The steps of an interactive rebase, oldest first: click an action to change it. */
function planEditor(plan: RebasePlan, p: Palette, a: OpsActions, busy: boolean): Element {
  const problem = planProblem(plan);
  const rows = plan.steps.map((s, i) =>
    h_flex()
      .h(22)
      .px(8)
      .gap(6)
      .items_center()
      .whitespace_nowrap()
      .child(div().w(58).flex_shrink_0().child(textButton(`rs:${i}`, s.action, p, (cx) => a.cycleStep(i, cx))))
      .child(div().w(60).flex_shrink_0().text_color(p.dim).child(s.hash.slice(0, 7)))
      .child(div().flex_1().min_w_0().truncate().text_color(p[STEP_COLOR[s.action]]).when(s.action === "drop", (el) => el.line_through()).child(s.subject))
      .child(textButton(`ru:${i}`, "↑", p, (cx) => a.moveStep(i, -1, cx)))
      .child(textButton(`rd:${i}`, "↓", p, (cx) => a.moveStep(i, 1, cx))),
  );
  return v_flex()
    .flex_shrink_0()
    .border_t_1()
    .border_color(p.border)
    .text_xs()
    .child(
      h_flex()
        .px(8)
        .py(3)
        .gap(6)
        .items_center()
        .child(div().flex_1().min_w_0().truncate().text_color(problem ? p.removed : p.muted).child(problem ?? `Rewrite ${plan.steps.length} commits, oldest first. squash/fixup join the one above; drop leaves it out.`))
        .child(textButton("plan-run", busy ? "Rebasing…" : "Run", p, a.runPlan, problem === null))
        .child(textButton("plan-cancel", "Cancel", p, a.cancelPlan)),
    )
    .child(v_flex().id("gitdeck-plan").max_h(220).overflow_y_scroll().children(rows));
}

export function commitBar(parts: OpsParts, p: Palette, a: OpsActions): Element | null {
  if (parts.view.plan) return planEditor(parts.view.plan, p, a, parts.view.busy !== null);
  const actions = parts.commit;
  if (actions === null) return null;
  if (parts.view.naming?.kind === "branch" || parts.view.naming?.kind === "tag") return namingRow(parts, p, a);
  const confirm = parts.view.confirm;
  if (confirm === "reset" || confirm === "reset-hard") {
    return h_flex()
      .px(8)
      .py(3)
      .gap(4)
      .items_center()
      .flex_shrink_0()
      .border_t_1()
      .border_color(p.border)
      .child(div().text_xs().text_color(p.dim).child("Reset the branch here, keeping:"))
      .child(textButton("reset-soft", "Soft (staged)", p, (cx) => a.reset("soft", cx)))
      .child(textButton("reset-mixed", "Mixed (unstaged)", p, (cx) => a.reset("mixed", cx)))
      .child(textButton("reset-hard", confirm === "reset-hard" ? "Hard: lose changes?" : "Hard (nothing)", p, (cx) => a.reset("hard", cx), confirm === "reset-hard"))
      .child(textButton("reset-cancel", "Cancel", p, a.dismiss));
  }
  const buttons = actions.map((action, i) => {
    const key = actionKey(action);
    const asking = confirm === key;
    const label = asking ? (CONFIRM[action.kind] ?? LABEL[action.kind]) : `${LABEL[action.kind]}${action.ref ? ` ${action.ref}` : ""}`;
    return textButton(`ca:${i}`, label, p, (cx) => a.commitAction(action, cx), asking);
  });
  return h_flex()
    .px(8)
    .py(3)
    .gap(4)
    .flex_wrap()
    .items_center()
    .flex_shrink_0()
    .border_t_1()
    .border_color(p.border)
    .children(buttons);
}

export const needsConfirm = (kind: ActionKind): boolean => CONFIRM[kind] !== undefined;
