// Feedback notes in Herdr: kept in a shared value (so the viewer tab adds what the
// panel sends), delivered with `hc send` into the agent's terminal. Nothing here
// starts a send by itself: notes are queued only by a button the person pressed,
// and the panel's timer only lets queued notes go once their agent is free.

import { agents, hc, panes, setShared, shared } from "herdr";
import { feedbackMessage } from "./core/feedback.ts";
import { batchHead, dueNotes, FEEDBACK_KEY, notesFor, sentNow, toDraft, withNotes, type BatchNote } from "./core/feedbackBatch.ts";

export function readNotes(repo: string): BatchNote[] {
  return notesFor(shared(FEEDBACK_KEY), repo);
}

export function saveNotes(repo: string, notes: readonly BatchNote[]): void {
  setShared(FEEDBACK_KEY, withNotes(shared(FEEDBACK_KEY), repo, notes));
}

export function noteId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The notes as one message for the agent, with the repo's branch. */
export function batchMessage(repo: string, notes: readonly BatchNote[]): string {
  const branch = panes().find((p) => p.cwd === repo)?.branch ?? null;
  return feedbackMessage({ branch, head: batchHead(notes) }, notes);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Types the text into the agent's terminal; why it didn't, or null. */
async function deliver(address: string, text: string): Promise<string | null> {
  try {
    const out = await hc(["send", address, text]);
    return out.code === 0 ? null : `Couldn't send: ${(out.stderr || out.stdout).trim() || `hc exited ${out.code}`}`;
  } catch (error) {
    return `Couldn't send: ${errorText(error)}`;
  }
}

/**
 * Sends some of a repo's notes now, as one message. They are marked sent first,
 * so a second look can't send them twice; a failure brings them back as drafts.
 */
export async function sendNotes(repo: string, ids: readonly string[], to: string): Promise<string | null> {
  const notes = readNotes(repo);
  const chosen = notes.filter((n) => ids.includes(n.id));
  if (chosen.length === 0) return null;
  const text = batchMessage(repo, chosen);
  saveNotes(repo, sentNow(notes, ids, to, Date.now()));
  const error = await deliver(to, text);
  if (error !== null) saveNotes(repo, toDraft(readNotes(repo), ids, error));
  return error;
}

const GONE = "Its terminal is gone: send to another agent, or copy";

/** Lets queued notes go to agents that stopped working (from the panel's timer). */
export function sendQueued(spawn: (task: () => Promise<void>) => void): void {
  const all = shared(FEEDBACK_KEY);
  if (typeof all !== "object" || all === null) return;
  const live = agents();
  for (const repo of Object.keys(all)) {
    const notes = notesFor(all, repo);
    const due = dueNotes(notes, live);
    if (due.gone.length > 0) saveNotes(repo, notes.map((n) => (due.gone.includes(n.id) ? { ...n, error: GONE } : n)));
    for (const d of due.send) spawn(async () => void (await sendNotes(repo, d.ids, d.to)));
  }
}
