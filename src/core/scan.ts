// Reading the herd from disk: which repos, and each one's status.

import { GitError, type Exec, type Git, type Target } from "./git/runner.ts";
import { parseStatus, STATUS_ARGS } from "./git/status.ts";
import { FILTER_CHECK_ARGS, repoFilterCommands } from "./git/trust.ts";
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

/** The repo's own filter commands. `git config --get-regexp` exits 1 when nothing matches. */
async function repoFilters(git: Git, target: Target): Promise<string[]> {
  try {
    return repoFilterCommands(await git(target, [...FILTER_CHECK_ARGS]));
  } catch (error) {
    if (error instanceof GitError && error.code === 1) return [];
    throw error;
  }
}

/** Never runs status where the repo's own config could make it run a program; fails closed. */
export async function loadStatus(git: Git, target: Target): Promise<StatusResult> {
  try {
    const untrusted = await repoFilters(git, target);
    if (untrusted.length > 0) return { status: null, error: null, untrusted };
    return { status: parseStatus(await git(target, [...STATUS_ARGS])), error: null };
  } catch (error) {
    return { status: null, error: message(error) };
  }
}
