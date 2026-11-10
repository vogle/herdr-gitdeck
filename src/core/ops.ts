// Branch, history and sync commands (M3), and the operation under way.

import { GitError, type Git, type Target } from "./git/runner.ts";

/** Editors can't open here (no terminal): git keeps the message it has. */
const NO_EDITOR = ["-c", "core.editor=true"];

/** Network commands fail instead of waiting for a password nobody can type. */
export const NET_ENV: readonly string[] = ["GIT_TERMINAL_PROMPT=0"];

export type CheckoutTarget = { kind: "branch" | "remote" | "commit"; name: string };

export function checkoutArgs(t: CheckoutTarget): string[] {
  if (t.kind === "remote") return ["switch", "--track", t.name];
  if (t.kind === "commit") return ["switch", "--detach", t.name];
  return ["switch", t.name];
}

export const createBranchArgs = (name: string, at: string, checkout: boolean): string[] =>
  checkout ? ["switch", "-c", name, at] : ["branch", name, at];
export const deleteBranchArgs = (name: string, force: boolean): string[] => ["branch", force ? "-D" : "-d", name];
export const tagArgs = (name: string, at: string): string[] => ["tag", name, at];

/**
 * Why git would refuse a new branch or tag name (git check-ref-format), or
 * null. A leading "-" is refused too: it would be read as an option.
 */
export function refNameProblem(name: string): string | null {
  if (name === "") return "Give it a name";
  if (name.startsWith("-")) return "A name can't start with -";
  if (name === "@" || name.includes("@{")) return "A name can't be @ or hold @{";
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return "A name can't hold spaces or ~ ^ : ? * [ \\";
  if (name.includes("..") || name.includes("//")) return "A name can't hold .. or //";
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return "A name can't start or end with /, or end with . or .lock";
  if (name.split("/").some((part) => part.startsWith("."))) return "No part of a name can start with .";
  return null;
}

export const mergeArgs = (ref: string): string[] => ["merge", "--no-edit", ref];
export const rebaseArgs = (onto: string): string[] => [...NO_EDITOR, "rebase", onto];
/** A merge commit is picked or reverted against its first parent. */
export const cherryPickArgs = (hash: string, parents: number): string[] => ["cherry-pick", ...(parents > 1 ? ["-m", "1"] : []), hash];
export const revertArgs = (hash: string, parents: number): string[] => ["revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), hash];

export type ResetMode = "soft" | "mixed" | "hard";
export const resetArgs = (hash: string, mode: ResetMode): string[] => ["reset", `--${mode}`, hash];

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";
export const sequenceArgs = (op: Operation, step: "continue" | "abort" | "skip"): string[] => [...NO_EDITOR, op, `--${step}`];

/**
 * Stash matches files with pathspec patterns of its own (it is broken by
 * --literal-pathspecs); it takes no paths from gitdeck, so patterns are back on.
 */
const STASH = ["--no-literal-pathspecs", "stash"];

export function stashPushArgs(message: string, untracked: boolean): string[] {
  const m = message.trim();
  return [...STASH, "push", ...(untracked ? ["--include-untracked"] : []), ...(m === "" ? [] : ["-m", m])];
}
export const stashArgs = (verb: "apply" | "pop" | "drop", name: string): string[] => [...STASH, verb, name];

export const fetchArgs = (): string[] => ["fetch", "--all", "--prune"];
export const pullArgs = (): string[] => [...NO_EDITOR, "pull", "--no-edit"];

/** A branch without an upstream is pushed to origin (else the first remote) and tracks it. */
export function pushArgs(branch: string | null, upstream: string | null, remotes: readonly string[]): string[] | null {
  if (upstream !== null) return ["push"];
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  return branch === null || remote === undefined ? null : ["push", "-u", remote, branch];
}

const MARKERS: ReadonlyArray<readonly [string, Operation]> = [
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["REBASE_HEAD", "rebase"],
];

async function present(git: Git, target: Target, ref: string): Promise<boolean> {
  try {
    await git(target, ["rev-parse", "-q", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

/** The operation stopped half way (conflicts, or a rebase stopped to edit), or null. */
export async function readOperation(git: Git, target: Target, read: (path: string) => Promise<string | null>): Promise<Operation | null> {
  const found = await Promise.all(MARKERS.map(([ref]) => present(git, target, ref)));
  const index = found.indexOf(true);
  if (index >= 0) return MARKERS[index]?.[1] ?? null;
  try {
    const gitDir = (await git(target, ["rev-parse", "--absolute-git-dir"])).trim();
    const merge = await read(`${gitDir}/rebase-merge/head-name`);
    const apply = merge === null ? await read(`${gitDir}/rebase-apply/head-name`) : merge;
    return apply === null ? null : "rebase";
  } catch {
    return null;
  }
}

/** Runs one command: null when it worked, else what went wrong in one line. */
export async function runOp(git: Git, target: Target, args: readonly string[]): Promise<string | null> {
  try {
    await git(target, [...args]);
    return null;
  } catch (error) {
    if (!(error instanceof GitError)) return error instanceof Error ? error.message : String(error);
    // A conflict is reported on stdout, with only a generic exit on stderr.
    const conflict = error.stdout.split("\n").find((l) => l.startsWith("CONFLICT"));
    return conflict ? `${conflict.trim()} (and any others): resolve, stage, then Continue` : error.message;
  }
}

/** The repo's remotes, by name. */
export async function readRemotes(git: Git, target: Target): Promise<string[]> {
  try {
    return (await git(target, ["remote"])).split("\n").map((l) => l.trim()).filter((l) => l !== "");
  } catch {
    return [];
  }
}
