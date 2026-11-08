// What the uncommitted-changes panel shows: the file side open, its diff, the
// lines picked to stage, a pending confirmation, and the last action's error.

import type { Pick } from "./stage.ts";
import { lineRef } from "./stage.ts";
import type { StageDiff } from "./staging.ts";

export interface OpenSide {
  path: string;
  /** The staged side (HEAD to index), else the unstaged side. */
  staged: boolean;
  untracked: boolean;
}

export interface ChangesView {
  repo: string | null;
  open: OpenSide | null;
  diff: StageDiff | null;
  /** Diff row indices picked for a partial stage. */
  picked: ReadonlySet<number>;
  /** The key of an action waiting for a second click (discard). */
  confirm: string | null;
  amend: boolean;
  busy: boolean;
  error: string | null;
}

const NONE: ReadonlySet<number> = new Set();

export const emptyChanges = (repo: string | null): ChangesView => ({
  repo, open: null, diff: null, picked: NONE, confirm: null, amend: false, busy: false, error: null,
});

export const forRepoChanges = (v: ChangesView, repo: string | null): ChangesView => (v.repo === repo ? v : emptyChanges(repo));

export const openSide = (v: ChangesView, path: string, staged: boolean, untracked: boolean): ChangesView =>
  ({ ...v, open: { path, staged, untracked }, diff: null, picked: NONE, confirm: null });

export const closeSide = (v: ChangesView): ChangesView => ({ ...v, open: null, diff: null, picked: NONE });

/** Ignores a diff that arrives after another file or side was opened. */
export function withStageDiff(v: ChangesView, path: string, staged: boolean, diff: StageDiff): ChangesView {
  return v.open?.path === path && v.open.staged === staged ? { ...v, diff, picked: NONE } : v;
}

export function togglePick(v: ChangesView, row: number): ChangesView {
  const kind = v.diff?.rows[row]?.kind;
  if (kind !== "add" && kind !== "del") return v;
  const next = new Set(v.picked);
  if (next.has(row)) next.delete(row);
  else next.add(row);
  return { ...v, picked: next };
}

/** The picked rows as lines per hunk. */
export function picks(v: ChangesView): Pick[] {
  const rows = v.diff?.rows ?? [];
  const byHunk = new Map<number, Set<number>>();
  for (const row of [...v.picked].sort((a, b) => a - b)) {
    const ref = lineRef(rows, row);
    if (ref) byHunk.set(ref.hunk, new Set([...(byHunk.get(ref.hunk) ?? []), ref.line]));
  }
  return [...byHunk].map(([hunk, lines]) => ({ hunk, lines }));
}

/** A click on a hunk header: the whole hunk. */
export function hunkPick(v: ChangesView, row: number): Pick | null {
  const rows = v.diff?.rows ?? [];
  const ref = rows[row]?.kind === "hunk" ? lineRef(rows, row) : null;
  return ref ? { hunk: ref.hunk, lines: null } : null;
}

export const askConfirm = (v: ChangesView, key: string | null): ChangesView => ({ ...v, confirm: key });
export const setAmend = (v: ChangesView, amend: boolean): ChangesView => ({ ...v, amend });
export const setBusy = (v: ChangesView, busy: boolean): ChangesView => ({ ...v, busy });

/** An action finished: its error (or none), and the picks it used are spent. */
export const withResult = (v: ChangesView, error: string | null): ChangesView =>
  ({ ...v, busy: false, error, confirm: null, picked: NONE });
