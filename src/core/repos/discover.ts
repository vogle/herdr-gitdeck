// Finding the herd: the outermost repo around the focused folder, and every repo below it.

import { GitError, type Git, type Target } from "../git/runner.ts";
import { basename, dirname, isInside, relative, trimSlash } from "../paths.ts";

export interface Repo {
  path: string;
  name: string;
  /** Its parent folder below the herd root ("" for the root's direct children). */
  group: string;
}

export const MAX_REPOS = 500;

/** Folders never searched: build output and dependencies hold copies of repos, and are huge. */
export const SKIP_DIRS: readonly string[] = ["node_modules", "vendor", "target", "dist", "build", "Pods", "DerivedData"];

/**
 * `find` arguments listing every `.git` (a folder, or a file for worktrees and
 * submodules) up to `depth` folders below `root`, without entering hidden folders
 * or SKIP_DIRS. `.git` is matched before hidden folders are pruned.
 */
export function findArgs(root: string, depth: number): string[] {
  const levels = Math.min(Math.max(Math.trunc(depth), 1), 6);
  const skip = SKIP_DIRS.flatMap((name, i) => (i === 0 ? ["-name", name] : ["-o", "-name", name]));
  return [
    trimSlash(root),
    // The root itself is never tested, so a root named `build` or `.dotfiles` isn't pruned.
    "-mindepth",
    "1",
    "-maxdepth",
    String(levels + 1),
    "(",
    "-name",
    ".git",
    "-print",
    "-prune",
    ")",
    "-o",
    "(",
    "-type",
    "d",
    "(",
    ...skip,
    "-o",
    "-name",
    ".*",
    ")",
    "-prune",
    ")",
  ];
}

export interface Found {
  repos: Repo[];
  /** More than `max` were printed; the rest were left out. */
  truncated: boolean;
}

/** The repos `find` printed, below `root` (the root itself left out), by group then name. */
export function parseFound(root: string, stdout: string, max: number = MAX_REPOS): Found {
  const base = trimSlash(root);
  const repos: Repo[] = [];
  let truncated = false;
  for (const line of stdout.split("\n")) {
    if (!line.endsWith("/.git")) continue;
    const path = dirname(line);
    if (path === base || !isInside(path, base)) continue;
    if (repos.length >= max) {
      truncated = true;
      break;
    }
    repos.push({ path, name: basename(path), group: relative(base, dirname(path)) });
  }
  repos.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return { repos, truncated };
}

async function toplevel(git: Git, target: Target): Promise<string | null> {
  try {
    const out = (await git(target, ["rev-parse", "--show-toplevel"])).trim();
    // Old git prints nothing (exit 0) in a bare repo or inside .git: not a work tree.
    return out === "" ? null : trimSlash(out);
  } catch (error) {
    // Not a repo (128). Anything else (git missing, machine unreachable) is a real failure.
    if (error instanceof GitError && error.code > 0) return null;
    throw error;
  }
}

export interface HerdRoot {
  /** Where to look for repos: the outermost repo around the folder, else the folder. */
  root: string;
  /** The repo the folder is in, or null. */
  focused: string | null;
}

/**
 * Climbs from the focused folder's repo to the outermost repo that contains it,
 * so a terminal inside `herd/svc-a` still shows `herd` and its siblings.
 * Never climbs to or above `home`.
 */
export async function findHerdRoot(git: Git, target: Target, home: string, maxClimb = 6): Promise<HerdRoot> {
  const focused = await toplevel(git, target);
  if (!focused) return { root: trimSlash(target.cwd), focused: null };
  let root = focused;
  for (let i = 0; i < maxClimb; i++) {
    const parent = dirname(root);
    if (parent === root || isInside(home, parent)) break;
    const outer = await toplevel(git, { cwd: parent, on: target.on });
    if (!outer || outer === root || isInside(home, outer)) break;
    root = outer;
  }
  return { root, focused };
}
