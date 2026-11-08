import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../src/core/pool.ts";

test("mapLimit keeps input order and never runs more than the limit at once", async () => {
  let running = 0;
  let peak = 0;
  const result = await mapLimit([30, 10, 20, 5, 1], 2, async (ms, i) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running -= 1;
    return `${i}:${ms}`;
  });
  assert.deepEqual(result, ["0:30", "1:10", "2:20", "3:5", "4:1"]);
  assert.equal(peak, 2);
});

test("mapLimit handles an empty list", async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});

test("mapLimit rejects a limit below 1", async () => {
  await assert.rejects(() => mapLimit([1], 0, async (x) => x), /limit/);
});
