// The feedback batch at the foot of the Review tab: the notes written in the
// viewer, the message they make, and where it goes. Folded to one line at first.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { FeedbackTarget } from "../core/feedback.ts";
import type { BatchNote, NoteState } from "../core/feedbackBatch.ts";
import { monoFont, textButton, type Palette } from "./style.ts";

export interface FeedbackBarParts {
  notes: readonly BatchNote[];
  /** The drafts as the message the agent would get; null with none. */
  message: string | null;
  /** Where the drafts go; null when no agent works in the repo here. */
  to: FeedbackTarget | null;
  /** More than one agent to choose from. */
  choice: boolean;
  open: boolean;
  busy: boolean;
  status: { ok: boolean; text: string } | null;
  /** Sent notes on files the agent has changed since. */
  changed: number;
}

export interface FeedbackBarActions {
  toggle: (cx: Context) => void;
  nextAgent: (cx: Context) => void;
  /** Sends the drafts: now, or (`later`) once the agent stops working. */
  send: (later: boolean, cx: Context) => void;
  copy: (cx: Context) => void;
  remove: (id: string, cx: Context) => void;
  unqueue: (cx: Context) => void;
  clearSent: (cx: Context) => void;
}

const WORD: Readonly<Record<NoteState, string>> = { draft: "to send", queued: "waiting", sent: "sent" };

function summary(notes: readonly BatchNote[], changed: number): string {
  const count = (s: NoteState) => notes.filter((n) => n.state === s).length;
  const parts = (["draft", "queued", "sent"] as const).filter((s) => count(s) > 0).map((s) => `${count(s)} ${WORD[s]}`);
  return `${parts.join(" · ")}${changed > 0 ? ` (${changed} changed since)` : ""}`;
}

function noteRow(n: BatchNote, p: Palette, a: FeedbackBarActions): Element {
  const tone = n.error ? p.removed : n.state === "sent" ? p.added : n.state === "queued" ? p.changed : p.muted;
  return v_flex()
    .flex_shrink_0()
    .px(10)
    .py(2)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .text_xs()
        .child(div().w(52).flex_shrink_0().text_color(tone).child(WORD[n.state]))
        .child(div().flex_shrink_0().max_w(220).truncate().text_color(p.accent).child(n.where))
        .child(div().flex_1().min_w_0().truncate().text_color(p.foreground).child(n.text))
        .child(textButton(`fb-rm-${n.id}`, "×", p, (cx) => a.remove(n.id, cx))),
    )
    .when(n.error !== null, (el) => el.child(div().pl(58).text_xs().text_color(p.removed).truncate().child(n.error ?? "")));
}

export function feedbackBar(parts: FeedbackBarParts, p: Palette, a: FeedbackBarActions): Element | null {
  const { notes } = parts;
  if (notes.length === 0 && parts.status === null) return null;
  const drafts = notes.some((n) => n.state === "draft");
  const head = h_flex()
    .id("fb-bar")
    .h(28)
    .px(10)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => a.toggle(cx))
    .child(div().w(14).flex_shrink_0().text_xs().text_color(p.dim).child(parts.open ? "▾" : "▸"))
    .child(div().flex_shrink_0().text_xs().font_semibold().text_color(p.muted).child("FEEDBACK"))
    .child(div().flex_1().min_w_0().truncate().text_xs().text_color(parts.changed > 0 ? p.changed : p.dim).child(summary(notes, parts.changed)));
  const bar = v_flex().flex_shrink_0().border_t_1().border_color(p.border).bg(p.chrome).child(head);
  if (!parts.open) {
    return parts.status ? bar.child(div().px(10).pb(4).text_xs().text_color(parts.status.ok ? p.added : p.removed).child(parts.status.text)) : bar;
  }
  const to = parts.to;
  const working = to?.status === "working";
  const message = parts.message;
  return bar
    .child(v_flex().id("fb-notes").max_h(160).overflow_y_scroll().children(notes.map((n) => noteRow(n, p, a))))
    .when(message !== null, (el) =>
      el.child(
        v_flex()
          .id("fb-preview")
          .mx(10)
          .my(4)
          .p(6)
          .max_h(140)
          .overflow_y_scroll()
          .rounded(4)
          .border_1()
          .border_color(p.border)
          .bg(p.surface)
          .font_family(monoFont())
          .text_xs()
          .text_color(p.dim)
          // Rows keep their height: in a scrolling column they would squash instead.
          .children((message ?? "").split("\n").map((line) => div().flex_shrink_0().truncate().child(line === "" ? " " : line))),
      ),
    )
    .when(parts.status !== null, (el) => el.child(div().px(10).text_xs().text_color(parts.status?.ok ? p.added : p.removed).child(parts.status?.text ?? "")))
    .child(
      h_flex()
        .px(8)
        .py(4)
        .gap(6)
        .items_center()
        .child(
          div()
            .flex_1()
            .min_w_0()
            .truncate()
            .text_xs()
            .text_color(p.dim)
            .child(to ? `To ${to.name}${working ? " (working)" : ""}` : "No agent works in this repo here: copy it instead"),
        )
        .when(parts.choice, (el) => el.child(textButton("fb-agent", "Other agent", p, a.nextAgent)))
        .when(notes.some((n) => n.state === "queued"), (el) => el.child(textButton("fb-unqueue", "Stop waiting", p, a.unqueue)))
        .when(notes.some((n) => n.state === "sent"), (el) => el.child(textButton("fb-clear", "Clear sent", p, a.clearSent)))
        .child(textButton("fb-bar-copy", "Copy", p, a.copy, false, drafts))
        .when(to !== null && working, (el) => el.child(textButton("fb-bar-now", "Send now", p, (cx) => a.send(false, cx), false, drafts && !parts.busy)))
        .when(to !== null, (el) =>
          el.child(
            textButton("fb-bar-send", parts.busy ? "Sending…" : working ? "Send when free" : "Send", p, (cx) => a.send(working, cx), true, drafts && !parts.busy),
          ),
        ),
    );
}
