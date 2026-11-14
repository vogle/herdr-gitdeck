// The note box under a diff in the viewer tab: lines picked in the diff, a note
// on them, and what will go to the agent working in the repo. "Add" keeps the note
// in the repo's batch (sent together from the Review tab); "Send now" sends just
// this one. Nothing is sent until the person presses a button, after seeing it.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, Textarea, TextareaState } from "gpui-base";
import { agents, panes } from "herdr";
import type { DiffRow } from "./core/git/diff.ts";
import { feedbackTarget, noteFor, pickRange, type RowRange } from "./core/feedback.ts";
import { newNote, type BatchNote } from "./core/feedbackBatch.ts";
import type { ViewerRequest } from "./core/panel.ts";
import { batchMessage, noteId, readNotes, saveNotes, sendNotes } from "./feedbackSend.ts";
import { monoFont, textButton, type Palette } from "./ui/style.ts";

type Status = { ok: boolean; text: string };

export class FeedbackBox {
  picked: RowRange | null = null;
  note!: TextareaState;
  busy = false;
  status: Status | null = null;

  init(): void {
    this.note = TextareaState.new({ placeholder: "What should the agent change here?", rows: 3 });
    this.note.on("change", (_e, cx) => cx.notify());
  }

  /** A new file on screen: the old pick no longer points anywhere. */
  reset(): void {
    this.picked = null;
    this.status = null;
  }

  pick(rows: readonly DiffRow[], at: number, cx: Context): void {
    const was = this.picked;
    this.picked = pickRange(was, at, rows);
    this.status = null;
    if (was === null && this.picked !== null) this.note.focus();
    cx.notify();
  }

  /** The note as it would be kept, or null with nothing picked or written. */
  private draft(r: ViewerRequest, rows: readonly DiffRow[], blob: string | null): BatchNote | null {
    if (r.view !== "diff" || this.picked === null || this.note.value().trim() === "") return null;
    const head = r.source.kind === "commit" ? r.source.hash : null;
    return newNote(noteId(), noteFor(rows, this.picked, r.source.path, this.note.value()), { path: r.source.path, head, blob });
  }

  private done(text: string, cx: Context): void {
    this.picked = null;
    this.note.set_value("");
    this.status = { ok: true, text };
    cx.notify();
  }

  private add(repo: string, note: BatchNote, cx: Context): void {
    const notes = [...readNotes(repo), note];
    saveNotes(repo, notes);
    const waiting = notes.filter((n) => n.state === "draft").length;
    this.done(`Added: ${waiting} note${waiting === 1 ? "" : "s"} to send from the Review tab`, cx);
  }

  private sendNow(repo: string, note: BatchNote, to: { address: string; name: string }, cx: Context): void {
    if (this.busy) return;
    this.busy = true;
    saveNotes(repo, [...readNotes(repo), note]);
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await sendNotes(repo, [note.id], to.address);
      this.busy = false;
      if (error === null) this.done(`Sent to ${to.name}`, cx);
      else {
        // The note stays in the batch as a draft, with why.
        this.status = { ok: false, text: error };
        cx.notify();
      }
    });
  }

  render(r: ViewerRequest, rows: readonly DiffRow[], p: Palette, blob: string | null): Element | null {
    if (r.view !== "diff") return null;
    if (this.picked === null) {
      return this.status ? div().px(10).py(4).flex_shrink_0().text_xs().text_color(this.status.ok ? p.added : p.removed).child(this.status.text) : null;
    }
    const note = this.draft(r, rows, blob);
    const text = note ? batchMessage(r.repo, [note]) : null;
    const where = noteFor(rows, this.picked, r.source.path, "").where;
    // A repo on another machine: its agent's terminal is not ours to type into.
    const target = r.on === null ? feedbackTarget(r.repo, agents(), panes()) : null;
    const waiting = readNotes(r.repo).filter((n) => n.state === "draft").length;
    return v_flex()
      .flex_shrink_0()
      .gap(6)
      .p(8)
      .border_t_1()
      .border_color(p.border)
      .bg(p.chrome)
      .child(div().text_xs().text_color(p.muted).child(`Note on ${where}${waiting > 0 ? ` · ${waiting} in the batch` : ""}`))
      .child(div().rounded(4).border_1().border_color(p.border).bg(p.surface).px(6).py(4).child(Textarea.new(this.note).w_full().text_sm()))
      .when(text !== null, (el) =>
        el.child(
          v_flex()
            .max_h(120)
            .overflow_hidden()
            .font_family(monoFont())
            .text_xs()
            .text_color(p.dim)
            .children((text ?? "").split("\n").map((line) => div().truncate().child(line === "" ? " " : line))),
        ),
      )
      .when(this.status !== null, (el) => el.child(div().text_xs().text_color(this.status?.ok ? p.added : p.removed).child(this.status?.text ?? "")))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(
            div()
              .flex_1()
              .min_w_0()
              .truncate()
              .text_xs()
              .text_color(p.dim)
              .child(target ? `Send now goes to ${target.name}${target.status === "working" ? " (working: it reads it after its turn)" : ""}` : "No agent works in this repo here: add it, or copy it"),
          )
          .child(textButton("fb-cancel", "Cancel", p, (cx) => this.pick(rows, this.picked?.from ?? 0, cx)))
          .child(
            textButton("fb-copy", "Copy", p, (cx) => {
              if (text === null) return;
              cx.write_to_clipboard(text);
              this.done("Copied: paste it where the agent can read it", cx);
            }, false, text !== null),
          )
          .when(target !== null, (el) =>
            el.child(textButton("fb-send", this.busy ? "Sending…" : "Send now", p, (cx) => target && note && this.sendNow(r.repo, note, target, cx), false, note !== null && !this.busy)),
          )
          .child(textButton("fb-add", "Add", p, (cx) => note && this.add(r.repo, note, cx), true, note !== null)),
      );
  }
}
