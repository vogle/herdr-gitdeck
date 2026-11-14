// Feedback for the agent working in a repo: the person picks lines in a diff,
// writes a note, and the note goes to the agent's terminal as one message that
// names the file, the lines, and quotes them (so the agent finds the spot even
// after it has moved the lines since).

import type { DiffRow } from "./git/diff.ts";
import type { AgentStatus } from "./repoAgents.ts";

/** Picked rows of a diff, by index, both ends included. */
export interface RowRange {
  from: number;
  to: number;
}

export interface FeedbackNote {
  /** `path:41-42`, or `path (removed lines 41)` when only removed lines were picked. */
  where: string;
  /** The picked lines, each with its diff mark; a long pick is cut short. */
  quote: string[];
  text: string;
}

/** What the notes were written against: the branch, and the commit shown. */
export interface FeedbackContext {
  branch: string | null;
  head: string | null;
}

export interface FeedbackTarget {
  address: string;
  name: string;
  status: AgentStatus;
}

const QUOTE_LINES = 6;
const MARK: Readonly<Record<string, string>> = { add: "+ ", del: "- ", ctx: "  " };

const isLine = (row: DiffRow | undefined): boolean => row !== undefined && row.kind !== "hunk" && row.kind !== "note";

/**
 * A click on row `at`: picks it when nothing is picked, widens the pick to it,
 * or clears the pick when it falls inside. A hunk header or a note isn't a line.
 */
export function pickRange(range: RowRange | null, at: number, rows: readonly DiffRow[]): RowRange | null {
  if (!isLine(rows[at])) return range;
  if (range === null) return { from: at, to: at };
  if (at >= range.from && at <= range.to) return null;
  return { from: Math.min(range.from, at), to: Math.max(range.to, at) };
}

const span = (numbers: readonly number[]): string => {
  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
};

export function noteFor(rows: readonly DiffRow[], range: RowRange, path: string, text: string): FeedbackNote {
  const picked = rows.slice(range.from, range.to + 1).filter(isLine);
  const fresh = picked.flatMap((r) => (r.new === null ? [] : [r.new]));
  const gone = picked.flatMap((r) => (r.old === null ? [] : [r.old]));
  const where = fresh.length > 0 ? `${path}:${span(fresh)}` : gone.length > 0 ? `${path} (removed lines ${span(gone)})` : path;
  const lines = picked.map((r) => `${MARK[r.kind] ?? "  "}${r.text}`);
  const quote = lines.length > QUOTE_LINES + 1 ? [...lines.slice(0, QUOTE_LINES), `… ${lines.length - QUOTE_LINES} more lines`] : lines;
  return { where, quote, text: text.trim() };
}

/** The notes as one message for the agent's terminal. */
export function feedbackMessage(context: FeedbackContext, notes: readonly FeedbackNote[]): string {
  const on = context.branch ? ` on ${context.branch}` : "";
  const at = context.head ? ` (at ${context.head.slice(0, 7)})` : "";
  const count = notes.length > 1 ? `, ${notes.length} notes` : "";
  const blocks = notes.map((n, i) => [`${i + 1}. ${n.where}`, ...n.quote.map((q) => `   > ${q}`), `   ${n.text}`].join("\n"));
  return [`Review feedback${on}${at}${count}:`, "", blocks.join("\n\n")].join("\n");
}

interface AgentLike {
  address: string;
  pane: string;
  status: AgentStatus;
  program: { name: string };
  /** Higher = changed more recently. */
  seq?: number;
}

interface PaneLike {
  pane: string;
  cwd: string | null;
}

const inside = (repo: string, cwd: string | null): boolean => typeof cwd === "string" && (cwd === repo || cwd.startsWith(`${repo}/`));

/** The agents feedback can go to: those in the repo, free ones first, then the most recently active. */
export function feedbackTargets(repo: string, agents: readonly AgentLike[], panes: readonly PaneLike[]): FeedbackTarget[] {
  const here = new Set(panes.filter((p) => inside(repo, p.cwd)).map((p) => p.pane));
  const busy = (a: AgentLike) => (a.status === "working" ? 1 : 0);
  return agents
    .filter((a) => here.has(a.pane))
    .sort((x, y) => busy(x) - busy(y) || (y.seq ?? 0) - (x.seq ?? 0))
    .map((a) => ({ address: a.address, name: a.program.name, status: a.status }));
}

/** The agent to send feedback to by default. */
export function feedbackTarget(repo: string, agents: readonly AgentLike[], panes: readonly PaneLike[]): FeedbackTarget | null {
  return feedbackTargets(repo, agents, panes)[0] ?? null;
}
