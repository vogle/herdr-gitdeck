// Branch controls: the notices every tab shows (the operation under way with
// continue/abort, the last result); and the selected commit's actions. Pull and
// push live in the header (header.ts), where every tab can reach them.

import { planProblem, type RebasePlan } from "../core/rebase.ts";
import { div, type Context, type Element, type MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex, Input, type InputState } from "gpui-base";
import type { ActionKind, CommitAction, OpsView } from "../core/opsView.ts";
import type { Operation } from "../core/ops.ts";
import { textButton, type Palette } from "./style.ts";

export interface OpsActions {
  fetch: (cx: Context) => void;
  pull: (cx: Context) => void;
  /** Links the branch to origin's branch of the same name (pushed without -u). */
  link: (cx: Context) => void;
  push: (cx: Context) => void;
  stash: (cx: Context) => void;
  sequence: (step: "continue" | "abort" | "skip", cx: Context) => void;
  commitAction: (action: CommitAction, cx: Context) => void;
  /** Reset: the mode picked after the first click. */
  reset: (mode: "soft" | "mixed" | "hard", cx: Context) => void;
  createName: (cx: Context) => void;
  cancelName: (cx: Context) => void;
  dismiss: (cx: Context) => void;
  /** A commit row was right-clicked: its menu opens. */
  openMenu: (hash: string, cx: Context) => void;
  /** The pane's own right press, just after: where the menu opens. */
  placeMenu: (event: MouseButtonEvent, cx: Context) => void;
  closeMenu: (cx: Context) => void;
  /** Runs the action held while an agent works. */
  runHeld: (cx: Context) => void;
  /** The squash waiting for its confirmation. */
  runPlan: (cx: Context) => void;
  cancelPlan: (cx: Context) => void;
}

export interface OpsParts {
  view: OpsView;
  ahead: number;
  behind: number;
  /** The right-click menu, placed: where in the pane, and its commit's actions. */
  menu: { x: number; y: number; actions: CommitAction[] } | null;
  name: InputState;
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
  "squash-later": "Squash later commits into this",
  reset: "Reset to here",
  "delete-branch": "Delete",
  "stash-apply": "Apply",
  "stash-pop": "Pop",
  "stash-drop": "Drop",
};

export const MENU_WIDTH = 200;
export const MENU_ITEM = 24;
export const MENU_PAD = 4;

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

/** What every tab shows at its foot: work under way, an operation to finish, a held action, the last result. */
export function opsNotices(parts: OpsParts, p: Palette, a: OpsActions): Element[] {
  const { view } = parts;
  const busy = view.busy === null ? null : div().px(10).py(3).flex_shrink_0().text_xs().text_color(p.dim).bg(p.raised).child(`${view.busy}…`);
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
  const held =
    view.held === null
      ? null
      : h_flex()
          .px(10)
          .py(3)
          .gap(6)
          .items_center()
          .flex_shrink_0()
          .bg(p.raised)
          .child(div().flex_1().min_w_0().text_xs().text_color(p.changed).child(view.held))
          .child(textButton("op-run-held", "Run anyway", p, a.runHeld, true))
          .child(textButton("op-hold-cancel", "Cancel", p, a.dismiss));
  return [...(busy ? [busy] : []), ...(view.operation ? [operationBanner(view.operation, p, a)] : []), ...(held ? [held] : []), ...(result ? [result] : [])];
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

/** "Squash N commits into <hash>?" above the list, with the reason when it can't run. */
function squashRow(plan: RebasePlan, p: Palette, a: OpsActions, busy: boolean): Element {
  const problem = planProblem(plan);
  const into = plan.steps[0]?.hash.slice(0, 7) ?? "";
  return h_flex()
    .px(8)
    .py(3)
    .gap(4)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .text_xs()
    .child(div().flex_1().min_w_0().truncate().text_color(problem ? p.removed : p.muted).child(problem ?? `Squash ${plan.steps.length - 1} commits into ${into}?`))
    .child(textButton("plan-run", busy ? "Squashing…" : "Squash", p, a.runPlan, problem === null))
    .child(textButton("plan-cancel", "Cancel", p, a.cancelPlan));
}

/** What an action from the menu still asks for, above the list: a name, a reset mode, or a squash to confirm. */
export function commitBar(parts: OpsParts, p: Palette, a: OpsActions): Element | null {
  if (parts.view.plan) return squashRow(parts.view.plan, p, a, parts.view.busy !== null);
  if (parts.view.naming?.kind === "branch" || parts.view.naming?.kind === "tag") return namingRow(parts, p, a);
  const confirm = parts.view.confirm;
  if (confirm !== "reset" && confirm !== "reset-hard") return null;
  return h_flex()
    .px(8)
    .py(3)
    .gap(4)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(div().text_xs().text_color(p.dim).child("Reset the branch here, keeping:"))
    .child(textButton("reset-soft", "Soft (staged)", p, (cx) => a.reset("soft", cx)))
    .child(textButton("reset-mixed", "Mixed (unstaged)", p, (cx) => a.reset("mixed", cx)))
    .child(textButton("reset-hard", confirm === "reset-hard" ? "Hard: lose changes?" : "Hard (nothing)", p, (cx) => a.reset("hard", cx), confirm === "reset-hard"))
    .child(textButton("reset-cancel", "Cancel", p, a.dismiss));
}

/** A commit's actions, as Fork offers them: a menu where the row was right-clicked. One needing a second click asks in place. */
export function commitMenu(parts: OpsParts, p: Palette, a: OpsActions): Element | null {
  const menu = parts.menu;
  if (menu === null) return null;
  const confirm = parts.view.confirm;
  const items = menu.actions.map((action, i) => {
    const asking = confirm === actionKey(action);
    const label = asking ? (CONFIRM[action.kind] ?? LABEL[action.kind]) : `${LABEL[action.kind]}${action.ref ? ` ${action.ref}` : ""}`;
    const danger = action.kind === "reset" || action.kind === "delete-branch" || action.kind === "stash-drop";
    return div()
      .id(`cm:${i}`)
      .h(MENU_ITEM)
      .px(10)
      .flex()
      .items_center()
      .rounded(4)
      .cursor_pointer()
      .text_xs()
      .whitespace_nowrap()
      .truncate()
      .text_color(asking ? p.changed : danger ? p.removed : p.foreground)
      .when(asking, (el) => el.bg(p.selected))
      .hover((el) => el.bg(p.hover))
      .on_click((_e, cx) => a.commitAction(action, cx))
      .child(label);
  });
  return v_flex()
    .id("commit-menu")
    .absolute()
    .left(menu.x)
    .top(menu.y)
    .w(MENU_WIDTH)
    .p(MENU_PAD)
    .rounded(6)
    .border_1()
    .border_color(p.border)
    .bg(p.raised)
    .shadow_lg()
    .on_mouse_down_out((_e, cx) => a.closeMenu(cx))
    .children(items);
}

export const needsConfirm = (kind: ActionKind): boolean => CONFIRM[kind] !== undefined;
