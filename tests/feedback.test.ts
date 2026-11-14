import { test } from "node:test";
import assert from "node:assert/strict";
import { feedbackMessage, feedbackTarget, feedbackTargets, noteFor, pickRange } from "../src/core/feedback.ts";
import type { DiffRow } from "../src/core/git/diff.ts";

const rows: DiffRow[] = [
  { kind: "hunk", old: null, new: null, text: "@@ -40,3 +40,4 @@" },
  { kind: "ctx", old: 40, new: 40, text: "const a = 1" },
  { kind: "del", old: 41, new: null, text: "const b = 2" },
  { kind: "add", old: null, new: 41, text: "const b = 3" },
  { kind: "add", old: null, new: 42, text: "const c = 4" },
  { kind: "ctx", old: 42, new: 43, text: "return a" },
];

test("pickRange: a first click picks a line, another widens, a click inside clears", () => {
  assert.deepEqual(pickRange(null, 3, rows), { from: 3, to: 3 });
  assert.deepEqual(pickRange({ from: 3, to: 3 }, 1, rows), { from: 1, to: 3 });
  assert.deepEqual(pickRange({ from: 1, to: 3 }, 5, rows), { from: 1, to: 5 });
  assert.equal(pickRange({ from: 1, to: 3 }, 2, rows), null);
  assert.deepEqual(pickRange({ from: 3, to: 4 }, 0, rows), { from: 3, to: 4 }, "a hunk header is not a line");
  assert.equal(pickRange(null, 0, rows), null);
  assert.equal(pickRange(null, 99, rows), null);
});

test("noteFor names the new lines, and quotes them with their marks", () => {
  const n = noteFor(rows, { from: 2, to: 4 }, "src/a.ts", "  use a constant  ");
  assert.equal(n.where, "src/a.ts:41-42");
  assert.deepEqual(n.quote, ["- const b = 2", "+ const b = 3", "+ const c = 4"]);
  assert.equal(n.text, "use a constant");
  assert.equal(noteFor(rows, { from: 3, to: 3 }, "a.ts", "x").where, "a.ts:41");
});

test("noteFor names only removed lines by their old numbers, and cuts a long quote", () => {
  assert.equal(noteFor(rows, { from: 2, to: 2 }, "a.ts", "x").where, "a.ts (removed lines 41)");
  const many: DiffRow[] = Array.from({ length: 12 }, (_, i) => ({ kind: "add", old: null, new: i + 1, text: `l${i + 1}` }));
  const n = noteFor(many, { from: 0, to: 11 }, "a.ts", "x");
  assert.equal(n.where, "a.ts:1-12");
  assert.equal(n.quote.length, 7);
  assert.equal(n.quote.at(-1), "… 6 more lines");
});

test("feedbackMessage reads as one message for the agent", () => {
  const note = noteFor(rows, { from: 3, to: 4 }, "src/a.ts", "use a constant");
  const text = feedbackMessage({ branch: "feat/x", head: "1a31598cafe" }, [note]);
  assert.equal(
    text,
    [
      "Review feedback on feat/x (at 1a31598):",
      "",
      "1. src/a.ts:41-42",
      "   > + const b = 3",
      "   > + const c = 4",
      "   use a constant",
    ].join("\n"),
  );
  assert.equal(feedbackMessage({ branch: null, head: null }, [note]).split("\n")[0], "Review feedback:");
  const two = feedbackMessage({ branch: "feat/x", head: null }, [note, { where: "b.ts", quote: [], text: "add a test" }]);
  assert.equal(two.split("\n")[0], "Review feedback on feat/x, 2 notes:");
  assert.ok(two.endsWith("2. b.ts\n   add a test"));
});

test("feedbackMessage shows control characters as text, so nothing types keys into the terminal", () => {
  const text = feedbackMessage({ branch: "b\x1b[2J", head: null }, [{ where: "a\r.ts:1", quote: ["+ x\r\x1b]0;hi\x07\ty"], text: "fix\rthis\x7f" }]);
  assert.equal(
    text,
    ["Review feedback on b\\x1b[2J:", "", "1. a\\r.ts:1", "   > + x\\r\\x1b]0;hi\\x07\ty", "   fix\\rthis\\x7f"].join("\n"),
  );
});

test("feedbackTargets lists the repo's agents: free ones first, then the most recent", () => {
  const seq = (a: ReturnType<typeof agent>, n: number) => ({ ...a, seq: n });
  const list = feedbackTargets("/r", [seq(agent("t1", "p1", "working"), 9), seq(agent("t2", "p2", "idle"), 1), seq(agent("t4", "p1", "done"), 5), agent("t3", "p3", "idle")], panes);
  assert.deepEqual(list.map((t) => t.address), ["t4", "t2", "t1"]);
});

const panes = [
  { pane: "p1", cwd: "/r" },
  { pane: "p2", cwd: "/r/sub" },
  { pane: "p3", cwd: "/other" },
];
const agent = (address: string, pane: string, status: "working" | "idle" | "done" | "blocked") => ({ address, pane, status, program: { name: "Claude Code", key: "claude" } });

test("feedbackTarget picks an agent in the repo, a free one before a working one", () => {
  assert.deepEqual(feedbackTarget("/r", [agent("t1", "p1", "working"), agent("t2", "p2", "idle"), agent("t3", "p3", "idle")], panes), {
    address: "t2",
    name: "Claude Code",
    status: "idle",
  });
  assert.equal(feedbackTarget("/r", [agent("t1", "p1", "working")], panes)?.address, "t1");
  assert.equal(feedbackTarget("/r", [agent("t3", "p3", "idle")], panes), null);
});
