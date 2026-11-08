// The branch and history actions' panel: what runs, what it said, what waits
// for a second click, a name being typed, and the operation under way.

import type { Ref } from "./git/refs.ts";
import type { Operation } from "./ops.ts";
import type { RebasePlan } from "./rebase.ts";

export interface OpsView {
  repo: string | null;
  /** The running action's label. */
  busy: string | null;
  error: string | null;
  notice: string | null;
  /** The action waiting for its second click. */
  confirm: string | null;
  /** A new branch or tag being named, at this commit. */
  naming: { kind: "branch" | "tag"; at: string } | null;
  operation: Operation | null;
  /** An interactive rebase being edited before it runs. */
  plan: RebasePlan | null;
}

export const emptyOps = (repo: string | null): OpsView => ({
  repo, busy: null, error: null, notice: null, confirm: null, naming: null, operation: null, plan: null,
});

export const forRepoOps = (v: OpsView, repo: string | null): OpsView => (v.repo === repo ? v : emptyOps(repo));

/** Unchanged while another action runs: the caller checks `busy` to know. */
export const started = (v: OpsView, label: string): OpsView =>
  v.busy !== null ? v : { ...v, busy: label, error: null, notice: null, confirm: null };

export const finished = (v: OpsView, error: string | null, notice: string | null): OpsView =>
  ({ ...v, busy: null, error, notice: error === null ? notice : null, confirm: null });

export const confirmOps = (v: OpsView, key: string | null): OpsView => ({ ...v, confirm: key });
export const startNaming = (v: OpsView, kind: "branch" | "tag", at: string): OpsView => ({ ...v, naming: { kind, at }, confirm: null });
export const stopNaming = (v: OpsView): OpsView => ({ ...v, naming: null });
export const withPlan = (v: OpsView, plan: RebasePlan | null): OpsView => ({ ...v, plan, confirm: null });
export const withOperation = (v: OpsView, operation: Operation | null): OpsView => ({ ...v, operation });

export type ActionKind =
  | "checkout-commit" | "checkout-branch" | "checkout-remote" | "branch" | "tag" | "cherry-pick" | "revert"
  | "merge" | "rebase" | "edit-after" | "reset" | "delete-branch" | "stash-apply" | "stash-pop" | "stash-drop";

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
    ...(!isHead && onBranch ? [{ kind: "merge" as const }, { kind: "rebase" as const }, { kind: "edit-after" as const }] : []),
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
