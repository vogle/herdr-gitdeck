// Reading the herd from disk: which repos, and each one's status.

import type { Exec, Git, Target } from "./git/runner.ts";
import { parseStatus, STATUS_ARGS } from "./git/status.ts";
import type { ScanResult, StatusResult } from "./herd.ts";
import { isInside } from "./paths.ts";
import { findArgs, findHerdRoot, parseFound } from "./repos/discover.ts";

export interface ScanDeps {
  git: Git;
  exec: Exec;
  /** The machine's home: never searched as a whole. */
  home: string;
  /** Folders below the root to search (1..6). */
  depth: number;
}

export interface Scan extends ScanResult {
  /** More repos than the limit: only the first ones are listed. */
  truncated: boolean;
  /** The search for repos failed (the root itself is still known). */
  error: string | null;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function scanHerd(deps: ScanDeps, target: Target): Promise<Scan> {
  const { root, focused } = await findHerdRoot(deps.git, target, deps.home);
  const rootIsRepo = focused !== null;
  const base = { root, rootIsRepo, focused };
  // A home folder (or above) that isn't itself a repo holds everything: don't walk it.
  if (!rootIsRepo && isInside(deps.home, root)) return { ...base, repos: [], truncated: false, error: null };
  try {
    // `find` exits 1 when a folder can't be read but still prints the rest.
    const found = await deps.exec("find", findArgs(root, deps.depth), { cwd: root, on: target.on });
    return { ...base, ...parseFound(root, found.stdout), error: null };
  } catch (error) {
    return { ...base, repos: [], truncated: false, error: `Couldn't search ${root} for repositories: ${message(error)}` };
  }
}

export async function loadStatus(git: Git, target: Target): Promise<StatusResult> {
  try {
    return { status: parseStatus(await git(target, [...STATUS_ARGS])), error: null };
  } catch (error) {
    return { status: null, error: message(error) };
  }
}
