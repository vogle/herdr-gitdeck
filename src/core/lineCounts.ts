// How many lines each changed file adds and removes, per side, to show on its row.
// Counts are a hint: a side that can't be read just shows none.

import type { Git, Target } from "./git/runner.ts";
import { parseNumstat, SAFE_DIFF, type LineCounts } from "./git/show.ts";

export interface ChangeCounts {
  staged: Readonly<Record<string, LineCounts>>;
  unstaged: Readonly<Record<string, LineCounts>>;
}

export const NO_COUNTS: ChangeCounts = { staged: {}, unstaged: {} };

/** New files aren't in either side's diff: they show no counts. */
export const countArgs = (staged: boolean): string[] => ["diff", ...SAFE_DIFF, "-z", "--numstat", ...(staged ? ["--cached"] : [])];

async function side(git: Git, target: Target, staged: boolean): Promise<Readonly<Record<string, LineCounts>>> {
  try {
    return parseNumstat(await git(target, countArgs(staged)));
  } catch {
    return {};
  }
}

export async function loadCounts(git: Git, target: Target): Promise<ChangeCounts> {
  const [staged, unstaged] = await Promise.all([side(git, target, true), side(git, target, false)]);
  return { staged, unstaged };
}
