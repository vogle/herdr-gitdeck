import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyChanges, askConfirm, setAmend, setBusy, withResult, forRepoChanges, changeSource } from "../src/core/changesView.ts";

test("confirm, amend, busy and results", () => {
  let v = askConfirm(emptyChanges("/r"), "discard:f");
  assert.equal(v.confirm, "discard:f");
  v = setAmend(setBusy(v, true), true);
  assert.equal(v.busy, true);
  assert.equal(v.amend, true);
  v = withResult(v, "boom");
  assert.equal(v.busy, false);
  assert.equal(v.error, "boom");
  assert.equal(v.confirm, null);
  assert.equal(withResult(v, null).error, null);
});

test("another repo starts over; the same repo keeps its state", () => {
  const v = setAmend(emptyChanges("/r"), true);
  assert.equal(forRepoChanges(v, "/r"), v);
  assert.equal(forRepoChanges(v, "/s").amend, false);
  assert.equal(forRepoChanges(v, "/s").repo, "/s");
});

test("resolving a conflict: open, choose a block, close", async () => {
  const { startResolving, chooseBlock } = await import("../src/core/changesView.ts");
  const { parseConflicts } = await import("../src/core/conflict.ts");
  const text = "<<<<<<< a\nx\n=======\ny\n>>>>>>> b";
  const v = startResolving(emptyChanges("/r"), { path: "f", original: text, segments: parseConflicts(text) });
  const chosen = chooseBlock(v, 0, "theirs");
  assert.equal(chosen.resolving?.segments[0]?.kind === "conflict" && chosen.resolving.segments[0].choice, "theirs");
  assert.equal(chooseBlock(emptyChanges("/r"), 0, "ours").resolving, null);
  assert.equal(startResolving(chosen, null).resolving, null);
});

test("changeSource: a file's side for the viewer, untracked files shown whole", () => {
  assert.deepEqual(changeSource({ path: "a", letter: "M", untracked: false }, true), { kind: "index", path: "a", staged: true });
  assert.deepEqual(changeSource({ path: "a", letter: "M", untracked: false }, false), { kind: "index", path: "a", staged: false });
  assert.deepEqual(changeSource({ path: "n", letter: "?", untracked: true }, false), { kind: "untracked", path: "n" });
});
