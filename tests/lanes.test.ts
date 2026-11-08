import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutLanes, type Segment } from "../src/core/graph/lanes.ts";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
const seg = (from: number, fromY: number, to: number, toY: number, dashed = false): Segment => ({ from, fromY, to, toY, dashed });

test("a straight history stays in lane 0", () => {
  const { rows, width } = layoutLanes([c("c", "b"), c("b", "a"), c("a")]);
  assert.equal(width, 1);
  assert.deepEqual(rows.map((r) => r.lane), [0, 0, 0]);
  assert.deepEqual(rows[0]?.segments, [seg(0, 0.5, 0, 1)]);
  assert.deepEqual(rows[1]?.segments, [seg(0, 0, 0, 0.5), seg(0, 0.5, 0, 1)]);
  assert.deepEqual(rows[2]?.segments, [seg(0, 0, 0, 0.5)]);
});

test("two branch tips from one commit join where it is", () => {
  const { rows, width } = layoutLanes([c("d", "b"), c("c", "b"), c("b", "a"), c("a")]);
  assert.equal(width, 2);
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 0, 0]);
  // c: d's line passes by on the left, c starts a lane.
  assert.deepEqual(rows[1]?.segments, [seg(0, 0, 0, 1), seg(1, 0.5, 1, 1)]);
  // b: both lanes end in its dot, lane 1 is free again.
  assert.deepEqual(rows[2]?.segments, [seg(0, 0, 0, 0.5), seg(1, 0, 0, 0.5), seg(0, 0.5, 0, 1)]);
  assert.deepEqual(rows[3]?.segments, [seg(0, 0, 0, 0.5)]);
});

test("a merge opens a lane for its second parent, which joins the first at their parent", () => {
  const { rows } = layoutLanes([c("m", "a", "b"), c("b", "a"), c("a")]);
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 0]);
  assert.deepEqual(rows[0]?.segments, [seg(0, 0.5, 0, 1), seg(0, 0.5, 1, 1)]);
  // b's parent a also waits in lane 0: b's line runs straight down to a's row.
  assert.deepEqual(rows[1]?.segments, [seg(0, 0, 0, 1), seg(1, 0, 1, 0.5), seg(1, 0.5, 1, 1)]);
  assert.deepEqual(rows[2]?.segments, [seg(0, 0, 0, 0.5), seg(1, 0, 0, 0.5)]);
});

test("a merge whose second parent already has a lane draws to it", () => {
  const { rows } = layoutLanes([c("x", "b"), c("m", "a", "b"), c("b", "a"), c("a")]);
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 0, 0]);
  assert.deepEqual(rows[1]?.segments, [seg(0, 0, 0, 1), seg(1, 0.5, 1, 1), seg(1, 0.5, 0, 1)]);
  assert.deepEqual(rows[2]?.segments, [seg(0, 0, 0, 0.5), seg(1, 0, 1, 1), seg(0, 0.5, 0, 1)]);
  assert.deepEqual(rows[3]?.segments, [seg(0, 0, 0, 0.5), seg(1, 0, 0, 0.5)]);
});

test("a freed lane is reused by the next new tip, and the width is the widest row", () => {
  const { rows, width } = layoutLanes([c("p", "a"), c("q", "a"), c("a"), c("r", "z"), c("z")]);
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 0, 0, 0]);
  assert.equal(width, 2);
});

test("a parent outside the loaded commits keeps its line to the bottom", () => {
  const { rows } = layoutLanes([c("b", "a")]);
  assert.deepEqual(rows[0]?.segments, [seg(0, 0.5, 0, 1)]);
});

test("a dashed commit (uncommitted changes) draws its line to its parent dashed", () => {
  const { rows } = layoutLanes([{ hash: "*", parents: ["h"], dashed: true }, c("h", "g"), c("g")]);
  assert.deepEqual(rows[0]?.segments, [seg(0, 0.5, 0, 1, true)]);
  assert.deepEqual(rows[1]?.segments, [seg(0, 0, 0, 0.5, true), seg(0, 0.5, 0, 1)]);
});

test("nothing to lay out", () => {
  assert.deepEqual(layoutLanes([]), { rows: [], width: 0 });
});
