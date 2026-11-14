// The feedback batch: notes written in the viewer collect here, per repo, until
// the person sends them together from the Review tab. A note sent to an agent
// that is still working waits ("queued") and goes once the agent stops; a sent
// note is kept so the person sees whether the agent changed the file since.
// Lives in a shared value, so the viewer tab and the panel see the same batch.

import type { FeedbackNote } from "./feedback.ts";

/** Shared value: repo path → its notes. */
export const FEEDBACK_KEY = "gitdeck.feedback";

export type NoteState = "draft" | "queued" | "sent";

export interface BatchNote extends FeedbackNote {
  id: string;
  path: string;
  /** The commit the note was written against; null for a work-tree diff. */
  head: string | null;
  /** The file's blob then (Review-tab files), to tell when the agent changed it since. */
  blob: string | null;
  state: NoteState;
  /** The agent's terminal address it is queued for, or was sent to. */
  to: string | null;
  /** When it was sent, ms since the epoch. */
  sentAt: number | null;
  /** Why the last send didn't go. */
  error: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const STATES: readonly unknown[] = ["draft", "queued", "sent"];

export function newNote(id: string, note: FeedbackNote, from: { path: string; head: string | null; blob: string | null }): BatchNote {
  return { ...note, ...from, id, state: "draft", to: null, sentAt: null, error: null };
}

function parseNote(v: unknown): BatchNote | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.path !== "string" || typeof v.where !== "string" || typeof v.text !== "string") return null;
  if (!Array.isArray(v.quote) || !v.quote.every((q) => typeof q === "string")) return null;
  if (!STATES.includes(v.state) || !textOrNull(v.head) || !textOrNull(v.blob) || !textOrNull(v.to) || !textOrNull(v.error)) return null;
  if (v.sentAt !== null && typeof v.sentAt !== "number") return null;
  return {
    id: v.id, path: v.path, where: v.where, quote: v.quote as string[], text: v.text,
    head: v.head, blob: v.blob, state: v.state as NoteState, to: v.to, sentAt: v.sentAt, error: v.error,
  };
}

/** One repo's notes from the shared value, anything malformed dropped. */
export function notesFor(all: unknown, repo: string): BatchNote[] {
  const mine = isObj(all) ? all[repo] : null;
  return Array.isArray(mine) ? mine.map(parseNote).filter((n): n is BatchNote => n !== null) : [];
}

/** The shared value with one repo's notes replaced; a repo left with none is dropped. */
export function withNotes(all: unknown, repo: string, notes: readonly BatchNote[]): Record<string, BatchNote[]> {
  const others = isObj(all)
    ? Object.fromEntries(Object.keys(all).filter((r) => r !== repo && Array.isArray(all[r])).map((r) => [r, notesFor(all, r)]))
    : {};
  return notes.length > 0 ? { ...others, [repo]: [...notes] } : others;
}

/** The drafts, queued for one agent: they go when it next stops working. */
export function queueFor(notes: readonly BatchNote[], to: string): BatchNote[] {
  return notes.map((n) => (n.state === "draft" ? { ...n, state: "queued", to, error: null } : n));
}

export function sentNow(notes: readonly BatchNote[], ids: readonly string[], to: string, at: number): BatchNote[] {
  const chosen = new Set(ids);
  return notes.map((n) => (chosen.has(n.id) ? { ...n, state: "sent", to, sentAt: at, error: null } : n));
}

/** Notes back to drafts: a queue cancelled, or a send that failed (with why). */
export function toDraft(notes: readonly BatchNote[], ids: readonly string[], error: string | null = null): BatchNote[] {
  const chosen = new Set(ids);
  return notes.map((n) => (chosen.has(n.id) ? { ...n, state: "draft", to: null, sentAt: null, error } : n));
}

export function withoutNote(notes: readonly BatchNote[], id: string): BatchNote[] {
  return notes.filter((n) => n.id !== id);
}

export function withoutSent(notes: readonly BatchNote[]): BatchNote[] {
  return notes.filter((n) => n.state !== "sent");
}

export interface Due {
  to: string;
  ids: string[];
}

/**
 * The queued notes ready to go: their agent is there and not working. Queued
 * notes whose agent's terminal is gone (and weren't told so yet) are `gone`.
 */
export function dueNotes(notes: readonly BatchNote[], agents: readonly { address: string; status: string }[]): { send: Due[]; gone: string[] } {
  const status = new Map(agents.map((a) => [a.address, a.status]));
  const send = new Map<string, string[]>();
  const gone: string[] = [];
  for (const n of notes) {
    if (n.state !== "queued" || n.to === null) continue;
    const s = status.get(n.to);
    if (s === undefined) {
      if (n.error === null) gone.push(n.id);
    } else if (s !== "working") send.set(n.to, [...(send.get(n.to) ?? []), n.id]);
  }
  return { send: [...send].map(([to, ids]) => ({ to, ids })), gone };
}

/** Sent notes on a file the agent has changed since (its blob moved on). */
export function changedSince(notes: readonly BatchNote[], blobs: ReadonlyMap<string, string>): number {
  return notes.filter((n) => {
    const now = blobs.get(n.path);
    return n.state === "sent" && n.blob !== null && now !== undefined && now !== n.blob;
  }).length;
}

/** The commit every note was written against, or null when they differ (or there are none). */
export function batchHead(notes: readonly BatchNote[]): string | null {
  const heads = new Set(notes.map((n) => n.head));
  return heads.size === 1 ? (notes[0]?.head ?? null) : null;
}
