// The shown branch against the main line: how far apart they are, and (for the
// Review tab) what changed since they split. Every git call goes through `Git`.

import type { Git, Target } from "./git/runner.ts";
import type { Ref } from "./git/refs.ts";

/** The main line, most likely first: a local branch beats its remote copy. */
const BASES = ["main", "master", "origin/main", "origin/master"] as const;

/** The branch to compare HEAD with, or null on the main line itself (or none exists). */
export function baseBranch(refs: readonly Ref[], current: string | null): string | null {
  const names = new Set(refs.filter((r) => r.kind === "branch" || r.kind === "remote").map((r) => r.name));
  const base = BASES.find((b) => names.has(b)) ?? null;
  if (base === null || current === null) return base;
  const short = base.replace(/^origin\//, "");
  return current === base || current === short ? null : base;
}

export function compareArgs(base: string): string[] {
  return ["rev-list", "--left-right", "--count", `${base}...HEAD`, "--"];
}

/** `rev-list --left-right --count` prints "behind<TAB>ahead". */
export function parseCompare(out: string): { behind: number; ahead: number } | null {
  const m = /^(\d+)\s+(\d+)/.exec(out.trim());
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
}

export interface Compare {
  base: string;
  ahead: number;
  behind: number;
}

export async function loadCompare(git: Git, target: Target, base: string): Promise<Compare | null> {
  try {
    const counts = parseCompare(await git(target, compareArgs(base)));
    return counts ? { base, ...counts } : null;
  } catch {
    return null;
  }
}
