// The history view's data: the graph's commits, refs and stashes, one commit's
// details, and a file's diff. Every git call goes through an injected `Git`.

import { GitError, type Git, type Target } from "./git/runner.ts";
import { logArgs, parseLog, parseStashes, STASH_ARGS, type Commit, type Stash } from "./git/log.ts";
import { parseRefs, refsByCommit, REFS_ARGS, type Ref } from "./git/refs.ts";
import {
  commitDiffArgs, detailArgs, filesArgs, joinFiles, parseDetail, parseNameStatus, parseNumstat,
  untrackedDiffArgs, worktreeDiffArgs, type CommitDetail, type CommitFile,
} from "./git/show.ts";
import { parseDiff, type Diff } from "./git/diff.ts";
import { stagedDiffArgs, unstagedDiffArgs } from "./stage.ts";
import { layoutLanes, type Lanes } from "./graph/lanes.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface History {
  commits: readonly Commit[];
  lanes: Lanes;
  refs: readonly Ref[];
  byCommit: Readonly<Record<string, readonly Ref[]>>;
  stashes: readonly Stash[];
  /** The log stopped at its limit: older commits exist. */
  limited: boolean;
  error: string | null;
}

export const EMPTY_HISTORY: History = {
  commits: [], lanes: { rows: [], width: 0 }, refs: [], byCommit: {}, stashes: [], limited: false, error: null,
};

async function stashesOf(git: Git, target: Target): Promise<Stash[]> {
  try {
    return parseStashes(await git(target, [...STASH_ARGS]));
  } catch {
    return [];
  }
}

export async function loadHistory(git: Git, target: Target, limit: number, knownRefs?: string): Promise<History> {
  const [refsOut, stashes] = await Promise.all([
    knownRefs ?? git(target, [...REFS_ARGS]).catch(() => ""),
    stashesOf(git, target),
  ]);
  const refs = parseRefs(refsOut);
  let commits: Commit[];
  try {
    commits = parseLog(await git(target, logArgs(limit)));
  } catch (error) {
    // Before the first commit HEAD names nothing and there are no refs: an empty history.
    if (refs.length === 0) return { ...EMPTY_HISTORY, stashes };
    return { ...EMPTY_HISTORY, refs, byCommit: refsByCommit(refs), stashes, error: message(error) };
  }
  return { commits, lanes: layoutLanes(commits), refs, byCommit: refsByCommit(refs), stashes, limited: commits.length >= limit, error: null };
}

/**
 * Reads the history again only when something it shows can have changed: the
 * refs (one cheap for-each-ref), `extra` (HEAD and the stash count, from the
 * status already read) or the limit. `history` is null when nothing changed.
 */
export async function refreshHistory(
  git: Git,
  target: Target,
  limit: number,
  key: string | null,
  extra: string,
): Promise<{ key: string; history: History | null }> {
  const refsOut = await git(target, [...REFS_ARGS]).catch(() => "");
  const next = `${limit}\x1e${extra}\x1e${refsOut}`;
  if (next === key) return { key, history: null };
  return { key: next, history: await loadHistory(git, target, limit, refsOut) };
}

/** The graph row standing for the work tree's changes. */
export const UNCOMMITTED = "*";

export function withUncommitted(commits: readonly Commit[], head: string | null, changes: number): readonly Commit[] {
  if (changes === 0) return commits;
  const row: Commit = { hash: UNCOMMITTED, parents: head ? [head] : [], author: "", email: "", time: 0, subject: `Uncommitted changes (${changes})` };
  return [row, ...commits];
}

export interface CommitView {
  detail: CommitDetail | null;
  files: readonly CommitFile[];
  error: string | null;
}

export async function loadCommit(git: Git, target: Target, hash: string, parents: readonly string[]): Promise<CommitView> {
  try {
    const [header, names, counts] = await Promise.all([
      git(target, detailArgs(hash)),
      git(target, filesArgs(hash, parents, "--name-status")),
      git(target, filesArgs(hash, parents, "--numstat")),
    ]);
    return { detail: parseDetail(header), files: joinFiles(parseNameStatus(names), parseNumstat(counts)), error: null };
  } catch (error) {
    return { detail: null, files: [], error: message(error) };
  }
}

export type DiffSource =
  | { kind: "commit"; hash: string; parents: readonly string[]; path: string; oldPath: string | null }
  | { kind: "worktree"; path: string; hasHead: boolean }
  | { kind: "untracked"; path: string }
  /** One side of an uncommitted file: what is staged, or what is not yet. */
  | { kind: "index"; path: string; staged: boolean };

function diffArgs(source: DiffSource): string[] {
  if (source.kind === "commit") return commitDiffArgs(source.hash, source.parents, source);
  if (source.kind === "worktree") return worktreeDiffArgs(source.path, source.hasHead);
  if (source.kind === "index") return source.staged ? stagedDiffArgs(source.path) : unstagedDiffArgs(source.path);
  return untrackedDiffArgs(source.path);
}

export async function loadDiff(git: Git, target: Target, source: DiffSource): Promise<Diff> {
  try {
    return parseDiff(await git(target, diffArgs(source)));
  } catch (error) {
    // `diff --no-index` exits 1 when the files differ, which is the point.
    if (source.kind === "untracked" && error instanceof GitError && error.code === 1) return parseDiff(error.stdout);
    return { rows: [{ kind: "note", old: null, new: null, text: `Can't show this diff: ${message(error)}` }], truncated: false };
  }
}

/** Indexes of the commits matching a query (all of them for a blank one). */
export function searchCommits(commits: readonly Commit[], byCommit: Readonly<Record<string, readonly Ref[]>>, query: string): number[] {
  const q = query.trim().toLowerCase();
  const all = commits.map((_c, i) => i);
  if (q === "") return all;
  return all.filter((i) => {
    const c = commits[i];
    if (!c) return false;
    const names = (byCommit[c.hash] ?? []).filter((r) => r.kind !== "remote").map((r) => r.name);
    return c.hash.startsWith(q) || [c.subject, c.author, c.email, ...names].some((s) => s.toLowerCase().includes(q));
  });
}
