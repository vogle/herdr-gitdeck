// Staging and committing against a repo: which files sit on which side, and
// the git calls that move them. Every action answers with an error text or null.

import { parseDiff, type DiffRow } from "./git/diff.ts";
import type { Git, Target } from "./git/runner.ts";
import type { StatusEntry } from "./git/status.ts";
import {
  applyArgs, buildPatch, cleanArgs, commitArgs, discardArgs, lastMessageArgs,
  stageArgs, stagedDiffArgs, unstageArgs, unstagedDiffArgs, type Pick,
} from "./stage.ts";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface ChangeFile {
  path: string;
  /** M, A, D, R, U (untracked), or the conflict's letters. */
  letter: string;
  untracked: boolean;
}

export interface Changes {
  staged: ChangeFile[];
  unstaged: ChangeFile[];
  conflicts: ChangeFile[];
}

/** A file changed on both sides is in both lists. */
export function splitChanges(entries: readonly StatusEntry[]): Changes {
  const staged: ChangeFile[] = [];
  const unstaged: ChangeFile[] = [];
  const conflicts: ChangeFile[] = [];
  for (const e of entries) {
    if (e.kind === "ignored") continue;
    if (e.kind === "conflict") conflicts.push({ path: e.path, letter: `${e.index}${e.worktree}`, untracked: false });
    else if (e.kind === "untracked") unstaged.push({ path: e.path, letter: "U", untracked: true });
    else {
      if (e.index !== ".") staged.push({ path: e.path, letter: e.index, untracked: false });
      if (e.worktree !== ".") unstaged.push({ path: e.path, letter: e.worktree, untracked: false });
    }
  }
  return { staged, unstaged, conflicts };
}

async function run(git: Git, target: Target, args: string[]): Promise<string | null> {
  try {
    await git(target, args);
    return null;
  } catch (error) {
    return message(error);
  }
}

export const stageFiles = (git: Git, target: Target, paths: readonly string[]): Promise<string | null> =>
  paths.length === 0 ? Promise.resolve(null) : run(git, target, stageArgs(paths));

export const unstageFiles = (git: Git, target: Target, paths: readonly string[], hasHead: boolean): Promise<string | null> =>
  paths.length === 0 ? Promise.resolve(null) : run(git, target, unstageArgs(paths, hasHead));

/** Throws away work-tree changes: tracked files go back to the index, untracked ones are deleted. */
export async function discardFiles(git: Git, target: Target, files: ReadonlyArray<{ path: string; untracked: boolean }>): Promise<string | null> {
  const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
  const untracked = files.filter((f) => f.untracked).map((f) => f.path);
  return (
    (tracked.length > 0 ? await run(git, target, discardArgs(tracked)) : null) ??
    (untracked.length > 0 ? await run(git, target, cleanArgs(untracked)) : null)
  );
}

export function commitChanges(git: Git, target: Target, text: string, amend: boolean): Promise<string | null> {
  const msg = text.trim();
  if (msg === "") return Promise.resolve("Write a commit message first");
  return run(git, target, commitArgs(msg, amend));
}

/** HEAD's message, to start an amend from; empty before the first commit. */
export async function readLastMessage(git: Git, target: Target): Promise<string> {
  try {
    return (await git(target, lastMessageArgs())).trim();
  } catch {
    return "";
  }
}

export interface StageDiff {
  raw: string;
  rows: readonly DiffRow[];
}

/** One side of a file's change: staged (HEAD to index) or not (index to work tree). */
export async function loadStageDiff(git: Git, target: Target, path: string, staged: boolean): Promise<StageDiff> {
  try {
    const raw = await git(target, staged ? stagedDiffArgs(path) : unstagedDiffArgs(path));
    return { raw, rows: parseDiff(raw).rows };
  } catch (error) {
    return { raw: "", rows: [{ kind: "note", old: null, new: null, text: `Can't show this diff: ${message(error)}` }] };
  }
}

/** Herdr's file calls, injected: read, and write only over what was read. */
export interface Files {
  read: (path: string) => Promise<string | null>;
  write: (path: string, text: string, expected: string | null) => Promise<unknown>;
}

/**
 * Stages (or, reversed, unstages) the picked hunks and lines. git applies a
 * patch from a file (exec has no stdin); it is written into the repo's git
 * folder, which only this machine's file calls reach.
 */
export async function applyPicks(git: Git, files: Files, target: Target, raw: string, picks: readonly Pick[], reverse: boolean): Promise<string | null> {
  if (target.on !== null) return "Staging parts of a file works only for repos on this machine";
  const patch = buildPatch(raw, picks, reverse);
  if (patch === null) return "Nothing picked to change";
  try {
    const gitDir = (await git(target, ["rev-parse", "--absolute-git-dir"])).trim();
    const file = `${gitDir}/githerd.patch`;
    await files.write(file, patch, await files.read(file));
    await git(target, applyArgs(file, reverse));
    return null;
  } catch (error) {
    return message(error);
  }
}
