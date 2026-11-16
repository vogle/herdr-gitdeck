// The Review tab's feedback batch for the shown repo: which agent it goes to, and
// the buttons' work. The notes themselves live in the shared value (feedbackSend).

import type { Context, Element } from "gpui-kit";
import { agents, panes } from "herdr";
import { feedbackTargets, type FeedbackTarget } from "./core/feedback.ts";
import { changedSince, newNote, queueFor, toDraft, withoutNote, withoutSent } from "./core/feedbackBatch.ts";
import { checkNotes } from "./core/forge/failedChecks.ts";
import { threadNotes, type ReviewThread } from "./core/forge/reviewThreads.ts";
import type { FailedCheck } from "./core/forge/types.ts";
import { batchMessage, noteId, readNotes, saveNotes, sendNotes } from "./feedbackSend.ts";
import { feedbackBar } from "./ui/feedbackBar.ts";
import type { Palette } from "./ui/style.ts";

export class FeedbackPanel {
  open = false;
  busy = false;
  /** Reading the PR/MR's review comments (on the person's click). */
  reading = false;
  status: { ok: boolean; text: string } | null = null;
  /** The agent the person chose (terminal address); null for the default. */
  chosen: string | null = null;

  private targets(repo: string, remote: boolean): FeedbackTarget[] {
    // A repo on another machine: its agent's terminal is not ours to type into.
    return remote ? [] : feedbackTargets(repo, agents(), panes());
  }

  private target(repo: string, remote: boolean): FeedbackTarget | null {
    const all = this.targets(repo, remote);
    return all.find((t) => t.address === this.chosen) ?? all[0] ?? null;
  }

  private say(ok: boolean, text: string, cx: Context): void {
    this.status = { ok, text };
    cx.notify();
  }

  private send(repo: string, to: FeedbackTarget, later: boolean, cx: Context): void {
    const notes = readNotes(repo);
    const ids = notes.filter((n) => n.state === "draft").map((n) => n.id);
    if (ids.length === 0 || this.busy) return;
    if (later) {
      saveNotes(repo, queueFor(notes, to.address));
      return this.say(true, `Waiting: they go to ${to.name} when it stops working`, cx);
    }
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await sendNotes(repo, ids, to.address);
      this.busy = false;
      if (error === null) this.say(true, `Sent ${ids.length} note${ids.length === 1 ? "" : "s"} to ${to.name}`, cx);
      else this.say(false, error, cx);
    });
  }

  /** How many of the failed checks aren't waiting in the batch yet. */
  checksToAdd(repo: string, failed: readonly FailedCheck[]): number {
    return failed.length === 0 ? 0 : checkNotes(failed, readNotes(repo)).length;
  }

  /** Puts the failed checks in the batch as drafts (no file: path "") and opens it, to send like any note. */
  addChecks(repo: string, failed: readonly FailedCheck[], head: string | null, cx: Context): void {
    const notes = readNotes(repo);
    const added = checkNotes(failed, notes).map((n) => newNote(noteId(), n, { path: "", head, blob: null }));
    if (added.length === 0) return;
    saveNotes(repo, [...notes, ...added]);
    this.open = true;
    this.say(true, `Added ${added.length} failed check${added.length === 1 ? "" : "s"}: send them when ready`, cx);
  }

  /** The open review threads read: those not waiting in the batch go in as drafts, and the batch opens. */
  addThreads(repo: string, read: { threads: readonly ReviewThread[]; error: string | null }, label: "PR" | "MR", head: string | null, cx: Context): void {
    this.reading = false;
    if (read.error !== null) return this.say(false, `Couldn't read the review comments: ${read.error}`, cx);
    const notes = readNotes(repo);
    const added = threadNotes(read.threads, label, notes).map((n) => newNote(noteId(), n, { path: "", head, blob: null }));
    if (added.length === 0) {
      const none = read.threads.length === 0 ? `No unresolved review comments on the ${label}` : "Those review comments are in the batch already";
      return this.say(true, none, cx);
    }
    saveNotes(repo, [...notes, ...added]);
    this.open = true;
    this.say(true, `Added ${added.length} review comment${added.length === 1 ? "" : "s"}: send them when ready`, cx);
  }

  render(repo: string, remote: boolean, blobs: ReadonlyMap<string, string>, p: Palette): Element | null {
    const notes = readNotes(repo);
    const drafts = notes.filter((n) => n.state === "draft");
    const all = this.targets(repo, remote);
    const to = this.target(repo, remote);
    return feedbackBar(
      {
        notes,
        message: drafts.length > 0 ? batchMessage(repo, drafts) : null,
        to,
        choice: all.length > 1,
        open: this.open,
        busy: this.busy,
        status: this.status,
        changed: changedSince(notes, blobs),
      },
      p,
      {
        toggle: (cx) => {
          this.open = !this.open;
          cx.notify();
        },
        nextAgent: (cx) => {
          const at = all.findIndex((t) => t.address === to?.address);
          this.chosen = all[(at + 1) % all.length]?.address ?? null;
          cx.notify();
        },
        send: (later, cx) => to && this.send(repo, to, later, cx),
        copy: (cx) => {
          if (drafts.length === 0) return;
          cx.write_to_clipboard(batchMessage(repo, drafts));
          this.say(true, "Copied: paste it where the agent can read it", cx);
        },
        remove: (id, cx) => {
          saveNotes(repo, withoutNote(readNotes(repo), id));
          cx.notify();
        },
        unqueue: (cx) => {
          const now = readNotes(repo);
          saveNotes(repo, toDraft(now, now.filter((n) => n.state === "queued").map((n) => n.id)));
          this.say(true, "Back to drafts: nothing was sent", cx);
        },
        clearSent: (cx) => {
          saveNotes(repo, withoutSent(readNotes(repo)));
          this.status = null;
          cx.notify();
        },
      },
    );
  }
}
