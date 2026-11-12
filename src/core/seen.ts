// "Seen": what the shown repo looked like when the person last looked, kept in
// memory only. Files an agent changed after that, and the commits it made on
// top, read as new. The folder watch already reports which paths were written,
// so this costs no extra git call.

import type { Commit } from "./git/log.ts";
import type { RepoStatus } from "./git/status.ts";

export interface Seen {
  repo: string;
  /** HEAD when marked; null before the first commit. */
  head: string | null;
  /** Each changed file as `path<NUL>XY` when marked. */
  files: ReadonlySet<string>;
  /** Work-tree paths (relative) written since the mark. */
  touched: ReadonlySet<string>;
}

const sign = (path: string, index: string, worktree: string): string => `${path}\0${index}${worktree}`;

function signs(status: RepoStatus): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of status.entries) if (e.kind !== "ignored") out.set(e.path, sign(e.path, e.index, e.worktree));
  return out;
}

export function markSeen(repo: string, status: RepoStatus): Seen {
  return { repo, head: status.oid, files: new Set(signs(status).values()), touched: new Set() };
}

/** Folders whose writes never count: git's own, and dependencies. */
const SKIP = /(^|\/)(\.git|node_modules)(\/|$)/;

/** Adds the watched paths written in the work tree (absolute) to the mark. */
export function touch(seen: Seen, root: string, paths: readonly string[]): Seen {
  const base = root.endsWith("/") ? root : `${root}/`;
  const fresh = paths
    .filter((p) => p.startsWith(base))
    .map((p) => p.slice(base.length))
    .filter((rel) => rel !== "" && !SKIP.test(rel) && !seen.touched.has(rel));
  return fresh.length === 0 ? seen : { ...seen, touched: new Set([...seen.touched, ...fresh]) };
}

/** The changed files that are new since the mark: a different state, or written again. */
export function freshPaths(seen: Seen, status: RepoStatus): Set<string> {
  const out = new Set<string>();
  for (const [path, s] of signs(status)) if (!seen.files.has(s) || seen.touched.has(path)) out.add(path);
  return out;
}

/** Commits on top of the marked HEAD (first parents, from the log); null when HEAD moved off it. */
export function newCommits(seen: Seen, head: string | null, log: readonly Commit[]): number | null {
  const byHash = new Map(log.map((c) => [c.hash, c]));
  let at = head;
  for (let n = 0; ; n++) {
    if (at === seen.head) return n;
    if (at === null) return null;
    const commit = byHash.get(at);
    if (!commit) return null;
    at = commit.parents[0] ?? null;
  }
}
