import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyChanges, openSide, withStageDiff, togglePick, picks, hunkPick, askConfirm, setAmend, setBusy, withResult, closeSide, forRepoChanges,
} from "../src/core/changesView.ts";
import { parseDiff } from "../src/core/git/diff.ts";

const RAW = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -9,1 +9,2 @@\n x\n+y\n";
const diff = { raw: RAW, rows: parseDiff(RAW).rows };

test("opening a side clears the old diff and picks; a late diff for another file is ignored", () => {
  let v = openSide(emptyChanges("/r"), "f", false, false);
  assert.deepEqual(v.open, { path: "f", staged: false, untracked: false });
  assert.equal(v.diff, null);
  v = withStageDiff(v, "g", false, diff);
  assert.equal(v.diff, null, "another file's diff");
  v = withStageDiff(v, "f", true, diff);
  assert.equal(v.diff, null, "the other side's diff");
  v = withStageDiff(v, "f", false, diff);
  assert.equal(v.diff, diff);
  v = togglePick(v, 2);
  assert.deepEqual([...v.picked], [2]);
  v = openSide(v, "f", true, false);
  assert.equal(v.diff, null);
  assert.equal(v.picked.size, 0);
  assert.equal(closeSide(v).open, null);
});

test("only added and removed lines can be picked, and a second click unpicks", () => {
  let v = withStageDiff(openSide(emptyChanges("/r"), "f", false, false), "f", false, diff);
  v = togglePick(v, 0); // hunk header
  v = togglePick(v, 1); // context
  v = togglePick(v, 99);
  assert.equal(v.picked.size, 0);
  v = togglePick(togglePick(v, 2), 3);
  assert.deepEqual([...v.picked].sort(), [2, 3]);
  assert.deepEqual([...togglePick(v, 2).picked], [3]);
});

test("picks groups picked rows by hunk, as lines inside each hunk", () => {
  let v = withStageDiff(openSide(emptyChanges("/r"), "f", false, false), "f", false, diff);
  v = togglePick(togglePick(togglePick(v, 2), 3), 7);
  assert.deepEqual(
    picks(v).map((p) => [p.hunk, [...(p.lines ?? [])]]),
    [[0, [1, 2]], [1, [1]]],
  );
  assert.deepEqual(hunkPick(v, 5), { hunk: 1, lines: null });
  assert.equal(hunkPick(v, 3), null, "not a hunk header");
});

test("confirm, amend, busy and results", () => {
  let v = askConfirm(emptyChanges("/r"), "discard:f");
  assert.equal(v.confirm, "discard:f");
  v = setAmend(setBusy(v, true), true);
  assert.equal(v.busy, true);
  assert.equal(v.amend, true);
  v = withResult(togglePick(withStageDiff(openSide(v, "f", false, false), "f", false, diff), 2), "boom");
  assert.equal(v.busy, false);
  assert.equal(v.error, "boom");
  assert.equal(v.confirm, null);
  assert.equal(v.picked.size, 0, "a done action clears the picks");
  assert.equal(withResult(v, null).error, null);
});

test("another repo starts over; the same repo keeps its state", () => {
  const v = setAmend(emptyChanges("/r"), true);
  assert.equal(forRepoChanges(v, "/r"), v);
  assert.equal(forRepoChanges(v, "/s").amend, false);
  assert.equal(forRepoChanges(v, "/s").repo, "/s");
});
