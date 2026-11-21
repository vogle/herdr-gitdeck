// What matching a commit to Claude Code sessions needs from git: when its parent
// was made, which folders the repo is checked out in, and the current branch.

import type { Git, Target } from "../git/runner.ts";
import type { CommitWindow } from "./claudeLog.ts";

export const parseWorktrees = (porcelain: string): string[] =>
  porcelain.split("\n").flatMap((line) => (line.startsWith("worktree ") ? [line.slice(9)] : []));

export async function commitWindow(
  git: Git,
  target: Target,
  commit: { time: number; parents: readonly string[]; files: readonly string[] },
): Promise<CommitWindow> {
  const parent = commit.parents[0];
  const [roots, parentTime, branch] = await Promise.all([
    git(target, ["worktree", "list", "--porcelain"]).then(parseWorktrees).catch(() => []),
    parent === undefined ? Promise.resolve(0) : git(target, ["log", "-1", "--format=%ct", parent]).then((o) => Number(o.trim()) || 0).catch(() => 0),
    git(target, ["rev-parse", "--abbrev-ref", "HEAD"]).then((o) => o.trim()).catch(() => ""),
  ]);
  return {
    time: commit.time,
    parentTime,
    files: commit.files,
    roots: roots.length > 0 ? roots : [target.cwd],
    branch: branch === "" || branch === "HEAD" ? null : branch,
  };
}
