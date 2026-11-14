// The shown branch against the main line: how far apart they are, and (for the
// Review tab) what changed since they split. Every git call goes through `Git`.

import type { Git, Target } from "./git/runner.ts";
import { filesArgs, joinFiles, parseNameStatus, parseNumstat, type CommitFile } from "./git/show.ts";
import type { Ref } from "./git/refs.ts";
import { parseBlobs } from "./reviewed.ts";

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

/** What the branch changed since it split from the base: HEAD against the merge base. */
export interface Review {
  base: string;
  /** Where the branch split off; null when git couldn't tell. */
  mergeBase: string | null;
  head: string;
  files: readonly CommitFile[];
  /** Each file's blob at HEAD (a deleted one: the blob it had), to tell a file changed after it was viewed. */
  blobs: ReadonlyMap<string, string>;
  error: string | null;
}

export async function loadReview(git: Git, target: Target, base: string, head: string): Promise<Review> {
  try {
    const mergeBase = (await git(target, ["merge-base", base, head])).trim();
    const [names, counts, raw] = await Promise.all([
      git(target, filesArgs(head, [mergeBase], "--name-status")),
      git(target, filesArgs(head, [mergeBase], "--numstat")),
      git(target, filesArgs(head, [mergeBase], "--raw")),
    ]);
    return { base, mergeBase, head, files: joinFiles(parseNameStatus(names), parseNumstat(counts)), blobs: parseBlobs(raw), error: null };
  } catch (error) {
    return { base, mergeBase: null, head, files: [], blobs: new Map(), error: error instanceof Error ? error.message : String(error) };
  }
}
