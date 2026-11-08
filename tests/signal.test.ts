import { test } from "node:test";
import assert from "node:assert/strict";
import { Signal } from "../src/core/signal.ts";

test("wait resolves on the next fire", async () => {
  const s = new Signal();
  let woke = false;
  const p = s.wait().then(() => {
    woke = true;
  });
  await Promise.resolve();
  assert.equal(woke, false);
  s.fire();
  await p;
  assert.equal(woke, true);
});

test("a fire with nobody waiting is kept for the next wait, and several fires count once", async () => {
  const s = new Signal();
  s.fire();
  s.fire();
  await s.wait();
  let second = false;
  void s.wait().then(() => {
    second = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(second, false);
});
