// Branch, history and sync actions (M3): each runs git in a task, then the
// shown repo's status and history are read again.

import type { AsyncContext, Context } from "gpui-kit";
import { InputState } from "gpui-base";
import { readTextFile } from "herdr";
import type { Git, Target } from "./core/git/runner.ts";
import type { RepoStatus } from "./core/git/status.ts";
import type { History } from "./core/history.ts";
import {
  checkoutArgs, cherryPickArgs, createBranchArgs, deleteBranchArgs, fetchArgs, mergeArgs, pullArgs, pushArgs, readOperation,
  readRemotes, rebaseArgs, refNameProblem, resetArgs, revertArgs, runOp, sequenceArgs, stashArgs, stashPushArgs, tagArgs,
  type ResetMode,
} from "./core/ops.ts";
import {
  commitActions, confirmOps, emptyOps, finished, forRepoOps, started, startNaming, stopNaming, withOperation, withPlan,
  type CommitAction, type OpsView,
} from "./core/opsView.ts";
import { files } from "./changes.ts";
import { FLOW_KINDS, flowBase, flowBranch } from "./core/flow.ts";
import { cycleStep, loadPlan, moveStep, runPlan, type RebasePlan } from "./core/rebase.ts";
import { actionKey, needsConfirm, type OpsActions, type OpsParts } from "./ui/ops.ts";

export interface OpsHost {
  git: Git;
  /** git with no password prompts, for the network. */
  net: Git;
  target: () => Target | null;
  status: () => RepoStatus | null;
  history: () => History | null;
  /** The selected commit (never the uncommitted row). */
  selected: () => { hash: string; parents: number } | null;
  changed: (cx: AsyncContext) => Promise<void>;
}

const readFile = (path: string): Promise<string | null> => readTextFile(path).catch(() => null);

export class OpsPanel {
  view: OpsView = emptyOps(null);
  name!: InputState;
  private readonly host: OpsHost;

  constructor(host: OpsHost) {
    this.host = host;
  }

  /** Needs a live host call: from init only. */
  init(): void {
    this.name = InputState.new({ placeholder: "name" });
  }

  /** Another commit was selected: a pending confirm or name is dropped. */
  reselected(): void {
    this.view = stopNaming(confirmOps(this.view, null));
  }

  forRepo(repo: string | null): void {
    this.view = forRepoOps(this.view, repo);
  }

  /** The merge, rebase, cherry-pick or revert stopped half way, if any. */
  async readOperation(cx: AsyncContext): Promise<void> {
    const target = this.host.target();
    if (!target) return;
    const op = await readOperation(this.host.git, target, readFile);
    if (this.view.repo !== target.cwd) return;
    this.view = withOperation(this.view, op);
    cx.notify();
  }

  commitList(): CommitAction[] | null {
    const sel = this.host.selected();
    const status = this.host.status();
    if (!sel || !status) return null;
    const history = this.host.history();
    return commitActions({
      hash: sel.hash,
      parents: sel.parents,
      refs: history?.byCommit[sel.hash] ?? [],
      stash: history?.stashes.find((s) => s.hash === sel.hash)?.name ?? null,
      head: status.oid,
      branch: status.branch,
    });
  }

  parts(): OpsParts {
    const status = this.host.status();
    const branches = (this.host.history()?.refs ?? []).filter((r) => r.kind === "branch").map((r) => r.name);
    const flow = FLOW_KINDS.filter((k) => flowBase(k, branches) !== null);
    return { view: this.view, ahead: status?.ahead ?? 0, behind: status?.behind ?? 0, commit: this.commitList(), name: this.name, flow };
  }

  /** Runs one action; `done` names it in the notice. */
  run(cx: Context, label: string, done: string, action: (target: Target) => Promise<string | null>): void {
    const target = this.host.target();
    if (!target || this.view.busy !== null) return;
    this.view = started(this.view, label);
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await action(target);
      this.view = finished(this.view, error, done);
      await this.host.changed(cx);
      await this.readOperation(cx);
      cx.notify();
    });
  }

  git(cx: Context, label: string, done: string, args: string[], net = false): void {
    this.run(cx, label, done, (target) => runOp(net ? this.host.net : this.host.git, target, args));
  }

  /** Reads the commits after `base` into the rebase editor. */
  openPlan(base: string, cx: Context): void {
    const target = this.host.target();
    if (!target) return;
    cx.spawn(async (cx) => {
      const loaded = await loadPlan(this.host.git, target, base);
      if (this.view.repo !== target.cwd) return;
      this.view = loaded.plan ? withPlan(this.view, loaded.plan) : finished(this.view, loaded.error, null);
      cx.notify();
    });
  }

  commitAction(a: CommitAction, cx: Context): void {
    const sel = this.host.selected();
    if (!sel) return;
    const key = actionKey(a);
    if (needsConfirm(a.kind) && this.view.confirm !== key) {
      this.view = confirmOps(this.view, key);
      cx.notify();
      return;
    }
    const at = a.ref ?? sel.hash;
    const short = a.ref ?? sel.hash.slice(0, 10);
    const stash = this.host.history()?.stashes.find((s) => s.hash === sel.hash)?.name ?? "";
    switch (a.kind) {
      case "checkout-commit":
        return this.git(cx, "Checking out", `Checked out ${short} (detached)`, checkoutArgs({ kind: "commit", name: sel.hash }));
      case "checkout-branch":
        return this.git(cx, "Switching", `Switched to ${short}`, checkoutArgs({ kind: "branch", name: at }));
      case "checkout-remote":
        return this.git(cx, "Switching", `Tracking ${short}`, checkoutArgs({ kind: "remote", name: at }));
      case "branch":
      case "tag":
        this.view = startNaming(this.view, a.kind, sel.hash);
        this.name.set_value("");
        this.name.focus();
        return cx.notify();
      case "cherry-pick":
        return this.git(cx, "Cherry-picking", `Picked ${short}`, cherryPickArgs(sel.hash, sel.parents));
      case "revert":
        return this.git(cx, "Reverting", `Reverted ${short}`, revertArgs(sel.hash, sel.parents));
      case "merge":
        return this.git(cx, "Merging", `Merged ${short}`, mergeArgs(at));
      case "rebase":
        return this.git(cx, "Rebasing", `Rebased onto ${short}`, rebaseArgs(at));
      case "edit-after":
        return this.openPlan(sel.hash, cx);
      case "reset":
        this.view = confirmOps(this.view, "reset");
        return cx.notify();
      case "delete-branch":
        return this.git(cx, "Deleting", `Deleted ${short}`, deleteBranchArgs(at, false));
      case "stash-apply":
        return this.git(cx, "Applying", `Applied ${stash}`, stashArgs("apply", stash));
      case "stash-pop":
        return this.git(cx, "Popping", `Popped ${stash}`, stashArgs("pop", stash));
      case "stash-drop":
        return this.git(cx, "Dropping", `Dropped ${stash}`, stashArgs("drop", stash));
    }
  }

  editPlan(change: (plan: RebasePlan) => RebasePlan | null, cx: Context): void {
    if (!this.view.plan || this.view.busy !== null) return;
    this.view = withPlan(this.view, change(this.view.plan));
    cx.notify();
  }

  actions(): OpsActions {
    return {
      fetch: (cx) => this.git(cx, "Fetching", "Fetched every remote", fetchArgs(), true),
      pull: (cx) => this.git(cx, "Pulling", "Pulled", pullArgs(), true),
      push: (cx) =>
        this.run(cx, "Pushing", "Pushed", async (target) => {
          const status = this.host.status();
          const args = pushArgs(status?.branch ?? null, status?.upstream ?? null, await readRemotes(this.host.git, target));
          if (args === null) return status?.branch ? "No remote to push to" : "Check out a branch to push";
          return runOp(this.host.net, target, args);
        }),
      stash: (cx) => this.git(cx, "Stashing", "Stashed every change, untracked files too", stashPushArgs("", true)),
      sequence: (step, cx) => {
        const op = this.view.operation;
        if (op) this.git(cx, `${step[0]?.toUpperCase()}${step.slice(1)}`, `${op} ${step === "abort" ? "aborted" : step === "skip" ? "skipped a commit" : "continued"}`, sequenceArgs(op, step));
      },
      commitAction: (a, cx) => this.commitAction(a, cx),
      reset: (mode: ResetMode, cx) => {
        const sel = this.host.selected();
        if (!sel) return;
        // A hard reset loses uncommitted work: it asks once more.
        if (mode === "hard" && this.view.confirm !== "reset-hard") {
          this.view = confirmOps(this.view, "reset-hard");
          return cx.notify();
        }
        this.git(cx, "Resetting", `Reset to ${sel.hash.slice(0, 10)} (${mode})`, resetArgs(sel.hash, mode));
      },
      createName: (cx) => {
        const naming = this.view.naming;
        if (!naming) return;
        const name = this.name.value().trim();
        const problem = refNameProblem(name);
        if (problem !== null) {
          this.view = finished(this.view, problem, null);
          return cx.notify();
        }
        this.view = stopNaming(this.view);
        if (naming.kind === "tag") this.git(cx, "Tagging", `Tagged ${name}`, tagArgs(name, naming.at));
        else if (naming.kind !== "branch") {
          const branch = flowBranch(naming.kind, name);
          this.git(cx, "Creating branch", `On ${branch}, from ${naming.at}`, createBranchArgs(branch, naming.at, true));
        } else this.git(cx, "Creating branch", `On new branch ${name}`, createBranchArgs(name, naming.at, true));
      },
      cancelName: (cx) => {
        this.view = stopNaming(this.view);
        cx.notify();
      },
      cycleStep: (i, cx) => this.editPlan((plan) => cycleStep(plan, i), cx),
      moveStep: (i, by, cx) => this.editPlan((plan) => moveStep(plan, i, by), cx),
      cancelPlan: (cx) => this.editPlan(() => null, cx),
      runPlan: (cx) => {
        const plan = this.view.plan;
        if (!plan) return;
        this.run(cx, "Rebasing", `Rewrote ${plan.steps.length} commits`, (target) => runPlan(this.host.git, files, target, plan));
        this.view = withPlan(this.view, null);
        cx.notify();
      },
      startFlow: (kind, cx) => {
        const branches = (this.host.history()?.refs ?? []).filter((r) => r.kind === "branch").map((r) => r.name);
        const base = flowBase(kind, branches);
        if (base === null) return;
        this.view = startNaming(this.view, kind, base);
        this.name.set_value("");
        this.name.focus();
        cx.notify();
      },
      dismiss: (cx) => {
        this.view = finished(confirmOps(this.view, null), null, null);
        cx.notify();
      },
    };
  }
}
