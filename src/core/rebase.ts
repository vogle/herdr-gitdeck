// Interactive rebase (M4) without an editor: githerd writes git's todo list
// and has git copy it in place of opening one.

import { logArgs, parseLog, type Commit } from "./git/log.ts";
import type { Git, Target } from "./git/runner.ts";
import { runOp } from "./ops.ts";
import type { Files } from "./staging.ts";

export type StepAction = "pick" | "squash" | "fixup" | "drop";

export interface Step {
  action: StepAction;
  hash: string;
  subject: string;
  /** A merge commit can't be replayed by a plain interactive rebase. */
  merge: boolean;
}

export interface RebasePlan {
  /** The commit the steps are replayed onto; null to rewrite from the root. */
  base: string | null;
  /** Oldest first, as git applies them. */
  steps: readonly Step[];
}

const NEXT: Record<StepAction, StepAction> = { pick: "squash", squash: "fixup", fixup: "drop", drop: "pick" };

/** `commits` newest first, as `git log` gives them. */
export function planOf(base: string | null, commits: readonly Commit[]): RebasePlan {
  return {
    base,
    steps: [...commits].reverse().map((c) => ({ action: "pick", hash: c.hash, subject: c.subject, merge: c.parents.length > 1 })),
  };
}

export function cycleStep(plan: RebasePlan, index: number): RebasePlan {
  return { ...plan, steps: plan.steps.map((s, i) => (i === index ? { ...s, action: NEXT[s.action] } : s)) };
}

export function moveStep(plan: RebasePlan, index: number, by: -1 | 1): RebasePlan {
  const to = index + by;
  const a = plan.steps[index];
  const b = plan.steps[to];
  if (!a || !b) return plan;
  return { ...plan, steps: plan.steps.map((s, i) => (i === index ? b : i === to ? a : s)) };
}

export function todoText(plan: RebasePlan): string {
  return plan.steps
    .filter((s) => s.action !== "drop")
    .map((s) => `${s.action} ${s.hash} ${s.subject}\n`)
    .join("");
}

/** Why the plan can't run, or null. */
export function planProblem(plan: RebasePlan): string | null {
  if (plan.steps.some((s) => s.merge)) return "The range holds a merge commit: rebase it from a later commit";
  const kept = plan.steps.filter((s) => s.action !== "drop");
  if (plan.steps.length === 0) return "Nothing to rebase";
  if (kept[0] && kept[0].action !== "pick") return "The first kept commit must be a pick: there is nothing to squash it into";
  return null;
}

/** The commits after `base` up to HEAD, newest first (first parents, as rebase replays them). */
export function rangeArgs(base: string | null): string[] {
  const format = logArgs(1).find((a) => a.startsWith("--format=")) ?? "";
  return ["log", "--no-show-signature", "--first-parent", format, "--max-count=200", base === null ? "HEAD" : `${base}..HEAD`, "--"];
}

/** For a shell command line: one word, whatever it holds. */
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * git runs `sequence.editor` with the todo file's path appended: `cp` puts
 * githerd's list there. A squash keeps the joined message (core.editor=true).
 */
export function interactiveArgs(base: string | null, todoPath: string): string[] {
  return ["-c", `sequence.editor=cp ${shellQuote(todoPath)}`, "-c", "core.editor=true", "rebase", "-i", base ?? "--root"];
}

export async function loadPlan(git: Git, target: Target, base: string | null): Promise<{ plan: RebasePlan | null; error: string | null }> {
  try {
    return { plan: planOf(base, parseLog(await git(target, rangeArgs(base)))), error: null };
  } catch (error) {
    return { plan: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const todoName = (): string => `githerd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.todo`;

/** Runs the plan. The todo file is new, in the repo's .git folder, and removed afterwards. */
export async function runPlan(git: Git, files: Files, target: Target, plan: RebasePlan): Promise<string | null> {
  if (target.on !== null) return "Interactive rebase works only for repos on this machine";
  const problem = planProblem(plan);
  if (problem !== null) return problem;
  let file: string | null = null;
  try {
    const gitDir = (await git(target, ["rev-parse", "--absolute-git-dir"])).trim();
    const name = `${gitDir}/${todoName()}`;
    await files.write(name, todoText(plan), null);
    file = name;
    return await runOp(git, target, interactiveArgs(plan.base, name));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    if (file !== null) await files.remove(file).catch(() => undefined);
  }
}
