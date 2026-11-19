// The header's sync chips: only the remote work there is to do, so an even
// branch shows none. A branch never pushed offers to publish it; a detached
// head has nothing to sync. A branch pushed without -u (origin has it, but it
// tracks nothing) offers to link it instead of publishing it again.

export interface SyncState {
  branch: string | null;
  upstream: string | null;
  /** origin's branch of the same name when there's no upstream (see RepoStatus). */
  remoteBranch?: string | null;
  ahead: number;
  behind: number;
}

export interface SyncChip {
  kind: "pull" | "push" | "link";
  label: string;
  tip: string;
}

export function syncChips(s: SyncState | null): SyncChip[] {
  if (s === null || s.branch === null) return [];
  if (s.upstream === null && s.remoteBranch) {
    return [{ kind: "link", label: `↔ Link ${s.remoteBranch}`, tip: `${s.remoteBranch} is on the server but this branch doesn't track it: link them` }];
  }
  if (s.upstream === null) return [{ kind: "push", label: "↑ Publish", tip: "Not pushed yet: publish the branch" }];
  const pull: SyncChip[] = s.behind > 0 ? [{ kind: "pull", label: `↓ Pull ${s.behind}`, tip: `${s.behind} commits on ${s.upstream} not here` }] : [];
  const push: SyncChip[] = s.ahead > 0 ? [{ kind: "push", label: `↑ Push ${s.ahead}`, tip: `${s.ahead} commits not on ${s.upstream} yet` }] : [];
  return [...pull, ...push];
}

/** "In sync with origin/x" when there's nothing to pull or push; null where a chip speaks instead. */
export function syncedNote(s: SyncState | null): string | null {
  if (s === null || s.branch === null || s.upstream === null || s.ahead > 0 || s.behind > 0) return null;
  return `In sync with ${s.upstream}`;
}
