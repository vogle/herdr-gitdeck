// The header's sync chips: only the remote work there is to do, so an even
// branch shows none. A branch never pushed offers to publish it; a detached
// head has nothing to sync.

export interface SyncState {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface SyncChip {
  kind: "pull" | "push";
  label: string;
  tip: string;
}

export function syncChips(s: SyncState | null): SyncChip[] {
  if (s === null || s.branch === null) return [];
  if (s.upstream === null) return [{ kind: "push", label: "↑ Publish", tip: "Not pushed yet: publish the branch" }];
  const pull: SyncChip[] = s.behind > 0 ? [{ kind: "pull", label: `↓ Pull ${s.behind}`, tip: `${s.behind} commits on ${s.upstream} not here` }] : [];
  const push: SyncChip[] = s.ahead > 0 ? [{ kind: "push", label: `↑ Push ${s.ahead}`, tip: `${s.ahead} commits not on ${s.upstream} yet` }] : [];
  return [...pull, ...push];
}
