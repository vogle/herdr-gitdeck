import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, dateTime } from "../src/core/time.ts";

const NOW = 1_700_000_000;

test("ago says how long ago in one short unit", () => {
  assert.equal(ago(NOW, NOW - 20), "now");
  assert.equal(ago(NOW, NOW - 120), "2m");
  assert.equal(ago(NOW, NOW - 3 * 3600), "3h");
  assert.equal(ago(NOW, NOW - 5 * 86400), "5d");
  assert.equal(ago(NOW, NOW - 70 * 86400), "2mo");
  assert.equal(ago(NOW, NOW - 800 * 86400), "2y");
  assert.equal(ago(NOW, NOW + 500), "now", "a clock ahead of ours is not the future");
  assert.equal(ago(NOW, 0), "");
});

test("dateTime is a fixed, sortable UTC-free local stamp", () => {
  const d = new Date(2024, 0, 2, 3, 4);
  assert.equal(dateTime(d.getTime() / 1000), "2024-01-02 03:04");
  assert.equal(dateTime(0), "");
});
