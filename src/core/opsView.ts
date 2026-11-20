// The branch and history actions' panel: what runs, what it said, what waits
// for a second click, a name being typed, and the operation under way.

import type { Ref } from "./git/refs.ts";
import type { Operation } from "./ops.ts";
import type { RebasePlan } from "./rebase.ts";
import type { FlowKind } from "./flow.ts";

/** A branch or tag at a commit, or a git-flow branch from its base. */
export type NameKind = "branch" | "tag" | FlowKind;

export interface OpsView {
  repo: string | null;
  /** The running action's label. */
  busy: string | null;
  error: string | null;
  notice: string | null;
  /** The action waiting for its second click. */
  confirm: string | null;
  /** A new branch or tag being named, at this commit. */
  naming: { kind: NameKind; at: string } | null;
  operation: Operation | null;
  /** A squash of later commits, loaded and waiting to be confirmed. */
  plan: RebasePlan | null;
  /** Why the clicked action waits: an agent is working in the repo. */
  held: string | null;
  /** The right-click menu: its commit, and where in the pane it opens (null until the pane's press places it). */
  menu: { hash: string; x: number | null; y: number | null } | null;
  /** The commit the last menu action was picked on: a name, reset or plan that follows acts on it. */
  subject: string | null;
}

export const emptyOps = (repo: string | null): OpsView => ({
  repo, busy: null, error: null, notice: null, confirm: null, naming: null, operation: null, plan: null, held: null, menu: null, subject: null,
});

export const forRepoOps = (v: OpsView, repo: string | null): OpsView => (v.repo === repo ? v : emptyOps(repo));

/** Unchanged while another action runs: the caller checks `busy` to know. */
export const started = (v: OpsView, label: string): OpsView =>
  v.busy !== null ? v : { ...v, busy: label, error: null, notice: null, confirm: null, held: null };

export const finished = (v: OpsView, error: string | null, notice: string | null): OpsView =>
  ({ ...v, busy: null, error, notice: error === null ? notice : null, confirm: null, held: null });

/** The action waits for "Run anyway": an agent is still writing in the repo. */
export const holdOps = (v: OpsView, why: string): OpsView => ({ ...v, held: why, confirm: null });

/** A row was right-clicked; the pane's own press reports where, just after (placeMenu). */
export const openMenu = (v: OpsView, hash: string): OpsView => ({ ...v, menu: { hash, x: null, y: null }, confirm: null });
export const placeMenu = (v: OpsView, x: number, y: number): OpsView =>
  v.menu === null || v.menu.x !== null ? v : { ...v, menu: { ...v.menu, x, y } };
export const closeMenu = (v: OpsView): OpsView => ({ ...v, menu: null, confirm: null });
/** An action was picked in the menu: it closes, and what follows acts on its commit. */
export const chooseFromMenu = (v: OpsView): OpsView => ({ ...v, menu: null, subject: v.menu?.hash ?? v.subject });

/** Where a menu of `width` × `height` opens for a press at x, y: inside the pane, above or left of the press when it would run past an edge. */
export function fitMenu(x: number, y: number, pane: { width: number; height: number }, width: number, height: number): { x: number; y: number } {
  const left = x + width > pane.width ? pane.width - width : x;
  const top = y + height > pane.height ? y - height : y;
  return { x: Math.max(0, left), y: Math.max(0, top) };
}

export const confirmOps = (v: OpsView, key: string | null): OpsView => ({ ...v, confirm: key });
export const startNaming = (v: OpsView, kind: NameKind, at: string): OpsView => ({ ...v, naming: { kind, at }, confirm: null });
export const stopNaming = (v: OpsView): OpsView => ({ ...v, naming: null });
export const withPlan = (v: OpsView, plan: RebasePlan | null): OpsView => ({ ...v, plan, confirm: null });
export const withOperation = (v: OpsView, operation: Operation | null): OpsView => ({ ...v, operation });

export type ActionKind =
  | "checkout-commit" | "checkout-branch" | "checkout-remote" | "branch" | "tag" | "cherry-pick" | "revert"
  | "merge" | "rebase" | "squash-later" | "reset" | "delete-branch" | "stash-apply" | "stash-pop" | "stash-drop";

export interface CommitAction {
  kind: ActionKind;
  /** The branch or remote branch it acts on; none for the commit itself. */
  ref?: string;
}

export interface CommitFacts {
  hash: string;
  parents: number;
  refs: readonly Ref[];
  /** The stash entry this commit is, if any. */
  stash: string | null;
  head: string | null;
  /** The checked-out branch; null when detached. */
  branch: string | null;
}

/** What can be done with a selected commit, the commit's own actions first. */
export function commitActions(c: CommitFacts): CommitAction[] {
  if (c.stash !== null) return [{ kind: "stash-apply" }, { kind: "stash-pop" }, { kind: "stash-drop" }];
  const isHead = c.hash === c.head;
  const onBranch = c.branch !== null;
  const own: CommitAction[] = [
    ...(isHead ? [] : [{ kind: "checkout-commit" as const }]),
    { kind: "branch" },
    { kind: "tag" },
    ...(isHead ? [] : [{ kind: "cherry-pick" as const }]),
    { kind: "revert" },
    ...(!isHead && onBranch ? [{ kind: "merge" as const }, { kind: "rebase" as const }, { kind: "squash-later" as const }] : []),
    { kind: "reset" },
  ];
  const byRef = c.refs.flatMap((r): CommitAction[] => {
    const into = onBranch && !r.current ? [{ kind: "merge" as const, ref: r.name }, { kind: "rebase" as const, ref: r.name }] : [];
    if (r.kind === "branch" && !r.current) return [{ kind: "checkout-branch", ref: r.name }, ...into, { kind: "delete-branch", ref: r.name }];
    if (r.kind === "remote") return [{ kind: "checkout-remote", ref: r.name }, ...into];
    return [];
  });
  return [...own, ...byRef];
}
