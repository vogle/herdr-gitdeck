// Picking lines of one side of a file's diff to stage (or unstage) only those:
// what the viewer tab holds while it shows a file to stage by line.

import { lineRef, type Pick } from "./stage.ts";
import type { StageDiff } from "./staging.ts";

export interface LinePicks {
  diff: StageDiff;
  /** Diff row indices picked. */
  picked: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set();

export const startPicks = (diff: StageDiff): LinePicks => ({ diff, picked: NONE });

/** The diff read again: unchanged, the picks stay; changed, they no longer point at the same lines. */
export const withFreshDiff = (v: LinePicks, diff: StageDiff): LinePicks => (diff.raw === v.diff.raw ? v : startPicks(diff));

export function togglePick(v: LinePicks, row: number): LinePicks {
  const kind = v.diff.rows[row]?.kind;
  if (kind !== "add" && kind !== "del") return v;
  const next = new Set(v.picked);
  if (!next.delete(row)) next.add(row);
  return { ...v, picked: next };
}

/** The picked rows as lines per hunk. */
export function picks(v: LinePicks): Pick[] {
  const byHunk = new Map<number, Set<number>>();
  for (const row of [...v.picked].sort((a, b) => a - b)) {
    const ref = lineRef(v.diff.rows, row);
    if (ref) byHunk.set(ref.hunk, new Set([...(byHunk.get(ref.hunk) ?? []), ref.line]));
  }
  return [...byHunk].map(([hunk, lines]) => ({ hunk, lines }));
}

/** A click on a hunk header: the whole hunk. */
export function hunkPick(v: LinePicks, row: number): Pick | null {
  const ref = v.diff.rows[row]?.kind === "hunk" ? lineRef(v.diff.rows, row) : null;
  return ref ? { hunk: ref.hunk, lines: null } : null;
}
