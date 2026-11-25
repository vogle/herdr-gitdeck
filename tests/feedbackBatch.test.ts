import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchHead, changedSince, dueNotes, newNote, notesFor, queueFor, sentNow, toDraft, withNotes, withoutNote, withoutSent, type BatchNote,
} from "../src/core/feedbackBatch.ts";

const note = (id: string, over: Partial<BatchNote> = {}): BatchNote => ({
  ...newNote(id, { where: `a.ts:${id}`, quote: ["+ x"], text: `fix ${id}` }, { path: "a.ts", head: "h1", blob: "b1" }),
  ...over,
});

test("newNote starts as a draft for nobody", () => {
  const n = note("1");
  assert.equal(n.state, "draft");
  assert.equal(n.to, null);
  assert.equal(n.sentAt, null);
  assert.equal(n.error, null);
  assert.equal(n.path, "a.ts");
});

test("notesFor reads one repo, dropping anything malformed; withNotes keeps other repos", () => {
  const all = { "/r": [note("1"), { id: 2 }, "x"], "/s": [note("9")], "/bad": "nope" };
  assert.deepEqual(notesFor(all, "/r").map((n) => n.id), ["1"]);
  assert.deepEqual(notesFor(all, "/none"), []);
  assert.deepEqual(notesFor("junk", "/r"), []);
  const next = withNotes(all, "/r", [note("3")]);
  assert.deepEqual(Object.keys(next).sort(), ["/r", "/s"]);
  assert.deepEqual(next["/r"]?.map((n) => n.id), ["3"]);
  assert.deepEqual(next["/s"]?.map((n) => n.id), ["9"]);
  assert.equal(Object.keys(withNotes(all, "/r", [])).includes("/r"), false, "an empty repo is dropped");
});

test("queueFor queues the drafts for one agent; toDraft takes them back", () => {
  const notes = [note("1"), note("2", { state: "sent", to: "t0", sentAt: 5 })];
  const queued = queueFor(notes, "t1");
  assert.deepEqual(queued.map((n) => [n.state, n.to]), [["queued", "t1"], ["sent", "t0"]]);
  assert.equal(notes[0]?.state, "draft", "not changed in place");
  assert.deepEqual(toDraft(queued, ["1"]).map((n) => [n.state, n.to]), [["draft", null], ["sent", "t0"]]);
});

test("sentNow marks the notes sent, with when and to whom; an error goes back to a draft", () => {
  const notes = [note("1", { state: "queued", to: "t1", error: "gone" }), note("2")];
  const sent = sentNow(notes, ["1", "2"], "t1", 100);
  assert.deepEqual(sent.map((n) => [n.state, n.to, n.sentAt, n.error]), [["sent", "t1", 100, null], ["sent", "t1", 100, null]]);
  const back = toDraft(sent, ["1"], "Couldn't send: no such terminal");
  assert.equal(back[0]?.state, "draft");
  assert.equal(back[0]?.error, "Couldn't send: no such terminal");
});

test("withoutNote and withoutSent remove", () => {
  const notes = [note("1"), note("2", { state: "sent" })];
  assert.deepEqual(withoutNote(notes, "1").map((n) => n.id), ["2"]);
  assert.deepEqual(withoutSent(notes).map((n) => n.id), ["1"]);
});

test("dueNotes: queued notes go once their agent stops working; a closed terminal is reported", () => {
  const notes = [
    note("1", { state: "queued", to: "t1" }),
    note("2", { state: "queued", to: "t1" }),
    note("3", { state: "queued", to: "t2" }),
    note("4", { state: "queued", to: "t3" }),
    note("5"),
  ];
  const due = dueNotes(notes, [
    { address: "t1", status: "idle" },
    { address: "t2", status: "working" },
  ]);
  assert.deepEqual(due.send, [{ to: "t1", ids: ["1", "2"] }]);
  assert.deepEqual(due.gone, ["4"]);
  assert.deepEqual(dueNotes([note("6", { state: "queued", to: "t3", error: "x" })], []).gone, [], "already told");
});

test("changedSince counts sent notes whose file the agent changed since", () => {
  const notes = [note("1", { state: "sent" }), note("2", { state: "sent", path: "b.ts", blob: "b2" }), note("3"), note("4", { state: "sent", blob: null })];
  const blobs = new Map([["a.ts", "b9"], ["b.ts", "b2"]]);
  assert.equal(changedSince(notes, blobs), 1);
});

test("batchHead is the commit the notes share, else none", () => {
  assert.equal(batchHead([note("1"), note("2")]), "h1");
  assert.equal(batchHead([note("1"), note("2", { head: "h2" })]), null);
  assert.equal(batchHead([]), null);
});
