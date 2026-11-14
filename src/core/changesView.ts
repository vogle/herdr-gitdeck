// What the uncommitted-changes panel holds: a pending confirmation, the amend
// switch, a conflict being resolved, and the last action's error. Staging by line
// happens in the viewer tab (linePicks.ts).

import type { ChangeFile } from "./staging.ts";
import type { DiffSource } from "./history.ts";
import { choose, type Choice, type Segment } from "./conflict.ts";

export interface ChangesView {
  repo: string | null;
  /** The key of an action waiting for a second click (discard). */
  confirm: string | null;
  amend: boolean;
  busy: boolean;
  error: string | null;
  /** A conflicted file being resolved block by block. */
  resolving: Resolving | null;
}

export interface Resolving {
  path: string;
  /** The file as read: the write is refused if it changed since. */
  original: string;
  segments: readonly Segment[];
}

export const emptyChanges = (repo: string | null): ChangesView => ({
  repo, confirm: null, amend: false, busy: false, error: null, resolving: null,
});

export const forRepoChanges = (v: ChangesView, repo: string | null): ChangesView => (v.repo === repo ? v : emptyChanges(repo));

export const askConfirm = (v: ChangesView, key: string | null): ChangesView => ({ ...v, confirm: key });
export const setAmend = (v: ChangesView, amend: boolean): ChangesView => ({ ...v, amend });
export const setBusy = (v: ChangesView, busy: boolean): ChangesView => ({ ...v, busy });

/** An action finished: its error, or none. */
export const withResult = (v: ChangesView, error: string | null): ChangesView => ({ ...v, busy: false, error, confirm: null });

export const startResolving = (v: ChangesView, r: Resolving | null): ChangesView => ({ ...v, resolving: r });

export function chooseBlock(v: ChangesView, index: number, choice: Choice): ChangesView {
  return v.resolving ? { ...v, resolving: { ...v.resolving, segments: choose(v.resolving.segments, index, choice) } } : v;
}

/** What the viewer tab shows for a clicked file: one side of it, or a new file whole. */
export const changeSource = (file: ChangeFile, staged: boolean): DiffSource =>
  file.untracked && !staged ? { kind: "untracked", path: file.path } : { kind: "index", path: file.path, staged };
