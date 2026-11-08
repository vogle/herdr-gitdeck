// What the panel shows, as one immutable value. Every change returns a new state.

import type { RepoStatus } from "./git/status.ts";
import type { Repo } from "./repos/discover.ts";
import { basename } from "./paths.ts";

export interface HerdRepo extends Repo {
  isRoot: boolean;
}

export interface StatusResult {
  status: RepoStatus | null;
  error: string | null;
}

export interface HerdState {
  root: string | null;
  repos: readonly HerdRepo[];
  selected: string | null;
  /** Keyed by repo path. */
  statuses: Readonly<Record<string, StatusResult>>;
  picking: boolean;
}

export function emptyHerd(): HerdState {
  return { root: null, repos: [], selected: null, statuses: {}, picking: false };
}

export interface ScanResult {
  root: string;
  rootIsRepo: boolean;
  focused: string | null;
  repos: readonly Repo[];
}

export interface ScanOptions {
  /** The scan follows a focus change: show the focused repo over the person's earlier pick. */
  followFocus?: boolean;
}

export function withRepos(state: HerdState, scan: ScanResult, options: ScanOptions = {}): HerdState {
  const rootRepo: HerdRepo[] = scan.rootIsRepo ? [{ path: scan.root, name: basename(scan.root), group: "", isRoot: true }] : [];
  const repos: HerdRepo[] = [...rootRepo, ...scan.repos.map((r) => ({ ...r, isRoot: false }))];
  const has = (path: string | null): path is string => path !== null && repos.some((r) => r.path === path);
  const sameRoot = state.root === scan.root;
  const keepPick = sameRoot && has(state.selected) && !(options.followFocus && has(scan.focused));
  const selected = keepPick ? state.selected : has(scan.focused) ? scan.focused : (repos[0]?.path ?? null);
  return {
    ...state,
    root: scan.root,
    repos,
    selected,
    statuses: sameRoot ? state.statuses : {},
  };
}

export function select(state: HerdState, path: string): HerdState {
  if (!state.repos.some((r) => r.path === path)) return state;
  return { ...state, selected: path, picking: false };
}

export function togglePicker(state: HerdState): HerdState {
  return { ...state, picking: !state.picking };
}

export function closePicker(state: HerdState): HerdState {
  return state.picking ? { ...state, picking: false } : state;
}

export function withStatus(state: HerdState, path: string, result: StatusResult): HerdState {
  return { ...state, statuses: { ...state.statuses, [path]: result } };
}

export function selectedRepo(state: HerdState): HerdRepo | null {
  return state.repos.find((r) => r.path === state.selected) ?? null;
}

export interface RepoGroup {
  group: string;
  repos: readonly HerdRepo[];
}

/** Consecutive repos by folder, order kept (the root sits with the direct children). */
export function groupRepos(repos: readonly HerdRepo[]): RepoGroup[] {
  return repos.reduce<RepoGroup[]>((groups, repo) => {
    const last = groups[groups.length - 1];
    if (last && last.group === repo.group) return [...groups.slice(0, -1), { group: last.group, repos: [...last.repos, repo] }];
    return [...groups, { group: repo.group, repos: [repo] }];
  }, []);
}
