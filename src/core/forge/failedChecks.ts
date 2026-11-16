// Failed checks as feedback for the agent: each says where to read why it
// failed (the CLI command for its log, or its page) and asks for a fix. They go
// through the feedback batch, so they wait for a busy agent like any note.

import type { FeedbackNote } from "../feedback.ts";
import type { NoteState } from "../feedbackBatch.ts";
import type { FailedCheck } from "./types.ts";

function checkNote(c: FailedCheck): FeedbackNote {
  const text = c.log
    ? `Read its log with \`${c.log}\` and fix what failed.${c.url ? ` Page: ${c.url}` : ""}`
    : c.url
      ? `Read why at ${c.url} and fix what failed.`
      : "Find out why it failed and fix it.";
  return { where: `Failed check: ${c.name}`, quote: [], text };
}

/** Notes for the failed checks not already waiting in the batch (a sent one may go again: it failed again). */
export function checkNotes(failed: readonly FailedCheck[], batch: readonly (FeedbackNote & { state: NoteState })[]): FeedbackNote[] {
  const waiting = new Set(batch.filter((n) => n.state !== "sent").map((n) => `${n.where}\n${n.text}`));
  return failed.map(checkNote).filter((n) => !waiting.has(`${n.where}\n${n.text}`));
}
