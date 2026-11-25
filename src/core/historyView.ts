// The history view of the shown repo, as one immutable value: the graph rows,
// which commit and file are open, the search. Every change returns a new view.

import type { Commit } from "./git/log.ts";
import type { Diff } from "./git/diff.ts";
import type { AgentSession } from "./agentLink/types.ts";
import { layoutLanes, type Lanes } from "./graph/lanes.ts";
import { searchCommits, withUncommitted, UNCOMMITTED, type CommitView, type History } from "./history.ts";

/** Commits read at first, and added by "show more". */
export const PAGE = 500;

export interface HistoryView {
  repo: string | null;
  /** null while the first read is under way. */
  history: History | null;
  /** HEAD and the number of changed files, from the repo's status. */
  head: string | null;
  changes: number;
  /** The rows shown: the uncommitted row, the commits, after the search. */
  rows: readonly Commit[];
  lanes: Lanes;
  query: string;
  searching: boolean;
  /** A commit's hash, or UNCOMMITTED. */
  selected: string | null;
  /** The selected commit's details; null while they load. */
  commit: CommitView | null;
  /** The agent sessions behind the selected commit; null while they load. */
  agents: readonly AgentSession[] | null;
  /** Commits with a recorded agent session (Entire, Git AI), marked in the list. */
  linked: ReadonlySet<string>;
  /** The file whose diff is open. */
  file: string | null;
  diff: Diff | null;
  limit: number;
  /** A row to bring on screen once, then cleared. */
  scrollTo: number | null;
}

const NO_LANES: Lanes = { rows: [], width: 0 };

export function emptyView(): HistoryView {
  return {
    repo: null, history: null, head: null, changes: 0, rows: [], lanes: NO_LANES, query: "", searching: false,
    selected: null, commit: null, agents: null, linked: new Set(), file: null, diff: null, limit: PAGE, scrollTo: null,
  };
}

/** Recomputes the rows from the history, the work tree and the search. */
function withRows(view: HistoryView): HistoryView {
  const all = withUncommitted(view.history?.commits ?? [], view.head, view.changes);
  const searching = view.query.trim() !== "";
  const rows = searching ? searchCommits(all, view.history?.byCommit ?? {}, view.query).flatMap((i) => all[i] ?? []) : all;
  const lanes = searching ? NO_LANES : layoutLanes(rows.map((r) => ({ ...r, dashed: r.hash === UNCOMMITTED })));
  const keep = view.selected !== null && all.some((c) => c.hash === view.selected);
  const cleared = keep ? {} : { selected: null, commit: null, agents: null, file: null, diff: null };
  return { ...view, ...cleared, rows, lanes, searching };
}

export function forRepo(view: HistoryView, repo: string | null): HistoryView {
  if (view.repo === repo) return view;
  return { ...emptyView(), repo };
}

export function withHistory(view: HistoryView, repo: string, history: History): HistoryView {
  if (view.repo !== repo) return view;
  return withRows({ ...view, history });
}

export function rebuild(view: HistoryView, head: string | null, changes: number): HistoryView {
  if (view.head === head && view.changes === changes) return view;
  return withRows({ ...view, head, changes });
}

export function setQuery(view: HistoryView, query: string): HistoryView {
  return withRows({ ...view, query });
}

export function selectCommit(view: HistoryView, hash: string): HistoryView {
  const selected = view.selected === hash ? null : hash;
  return { ...view, selected, commit: null, agents: null, file: null, diff: null };
}

export function withCommit(view: HistoryView, hash: string, commit: CommitView): HistoryView {
  return view.selected === hash ? { ...view, commit } : view;
}

export function withLinked(view: HistoryView, repo: string, linked: ReadonlySet<string>): HistoryView {
  return view.repo === repo ? { ...view, linked } : view;
}

export function withAgents(view: HistoryView, hash: string, agents: readonly AgentSession[]): HistoryView {
  return view.selected === hash ? { ...view, agents } : view;
}

export function openFile(view: HistoryView, path: string): HistoryView {
  return { ...view, file: path, diff: null };
}

export function withDiff(view: HistoryView, path: string, diff: Diff): HistoryView {
  return view.file === path ? { ...view, diff } : view;
}

export function closeFile(view: HistoryView): HistoryView {
  return { ...view, file: null, diff: null };
}

export function showMore(view: HistoryView): HistoryView {
  return { ...view, limit: view.limit + PAGE };
}

/** Selects a commit (a ref label or a link to it) and brings its row on screen. */
export function jumpTo(view: HistoryView, hash: string): HistoryView {
  const cleared = withRows({ ...view, query: "" });
  const index = cleared.rows.findIndex((r) => r.hash === hash);
  if (index < 0) return view;
  return { ...cleared, selected: hash, commit: null, file: null, diff: null, scrollTo: index };
}

export function scrolled(view: HistoryView): HistoryView {
  return view.scrollTo === null ? view : { ...view, scrollTo: null };
}

export { UNCOMMITTED };
