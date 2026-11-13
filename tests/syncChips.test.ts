import { test } from "node:test";
import assert from "node:assert/strict";
import { syncChips } from "../src/core/syncChips.ts";

const on = { branch: "feat/x", upstream: "origin/feat/x", ahead: 0, behind: 0 };

test("nothing to do shows nothing", () => {
  assert.deepEqual(syncChips(on), []);
});

test("commits to pull and to push each get a chip, pull first", () => {
  assert.deepEqual(
    syncChips({ ...on, ahead: 2, behind: 1 }).map((c) => [c.kind, c.label]),
    [
      ["pull", "↓ Pull 1"],
      ["push", "↑ Push 2"],
    ],
  );
});

test("a branch never pushed offers to publish it", () => {
  const [chip] = syncChips({ ...on, upstream: null });
  assert.equal(chip?.kind, "push");
  assert.equal(chip?.label, "↑ Publish");
});

test("a detached head has nothing to sync", () => {
  assert.deepEqual(syncChips({ branch: null, upstream: null, ahead: 0, behind: 0 }), []);
});

test("no status yet shows nothing", () => {
  assert.deepEqual(syncChips(null), []);
});
