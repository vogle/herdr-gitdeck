import { test } from "node:test";
import assert from "node:assert/strict";
import { hunkPick, picks, startPicks, togglePick, withFreshDiff } from "../src/core/linePicks.ts";
import { parseDiff } from "../src/core/git/diff.ts";

const RAW = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -9,1 +9,2 @@\n x\n+y\n";
const diff = { raw: RAW, rows: parseDiff(RAW).rows };

test("only added and removed lines can be picked, and a second click unpicks", () => {
  let v = startPicks(diff);
  v = togglePick(togglePick(togglePick(v, 0), 1), 99);
  assert.equal(v.picked.size, 0, "a hunk header, a context line and nothing at all");
  v = togglePick(togglePick(v, 2), 3);
  assert.deepEqual([...v.picked].sort(), [2, 3]);
  assert.deepEqual([...togglePick(v, 2).picked], [3]);
});

test("picks groups picked rows by hunk; a hunk header picks the whole hunk", () => {
  const v = togglePick(togglePick(togglePick(startPicks(diff), 2), 3), 7);
  assert.deepEqual(picks(v).map((p) => [p.hunk, [...(p.lines ?? [])]]), [[0, [1, 2]], [1, [1]]]);
  assert.deepEqual(hunkPick(v, 5), { hunk: 1, lines: null });
  assert.equal(hunkPick(v, 3), null, "not a hunk header");
});

test("the same diff read again keeps the picks; a changed one starts over", () => {
  const v = togglePick(startPicks(diff), 2);
  assert.equal(withFreshDiff(v, { ...diff }), v);
  const other = { raw: `${RAW} `, rows: diff.rows };
  assert.equal(withFreshDiff(v, other).picked.size, 0);
  assert.equal(withFreshDiff(v, other).diff, other);
});
