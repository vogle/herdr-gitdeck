// The Review tab's feedback batch for the shown repo: which agent it goes to, and
// the buttons' work. The notes themselves live in the shared value (feedbackSend).

import type { Context, Element } from "gpui-kit";
import { agents, panes } from "herdr";
import { feedbackTargets, type FeedbackTarget } from "./core/feedback.ts";
import { changedSince, queueFor, toDraft, withoutNote, withoutSent } from "./core/feedbackBatch.ts";
import { batchMessage, readNotes, saveNotes, sendNotes } from "./feedbackSend.ts";
import { feedbackBar } from "./ui/feedbackBar.ts";
import type { Palette } from "./ui/style.ts";

export class FeedbackPanel {
  open = false;
  busy = false;
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
