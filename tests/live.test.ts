import { test } from "node:test";
import assert from "node:assert/strict";
import { agentsKey, liveGap, MIN_GAP_MS, relevantChange } from "../src/core/live.ts";

const R = "/w/repo";

test("a change to a work tree file is worth a refresh", () => {
  assert.equal(relevantChange(R, [`${R}/src/a.ts`]), true);
});

test("a batch naming the root means everything may have changed", () => {
  assert.equal(relevantChange(R, [R]), true);
  assert.equal(relevantChange(R, [`${R}/`]), true);
});

test("git's object store, logs and lock files alone are noise", () => {
  assert.equal(relevantChange(R, [`${R}/.git/objects/ab/cdef`, `${R}/.git/logs/HEAD`, `${R}/.git/index.lock`, `${R}/.git/FETCH_HEAD`]), false);
});

test("HEAD, the index, refs and an operation in progress are what an agent's git leaves", () => {
  for (const p of [".git/HEAD", ".git/index", ".git/packed-refs", ".git/refs/heads/main", ".git/MERGE_HEAD", ".git/rebase-merge/done", ".git/CHERRY_PICK_HEAD"]) {
    assert.equal(relevantChange(R, [`${R}/${p}`]), true, p);
  }
});

test("dependency folders are noise wherever they are", () => {
  assert.equal(relevantChange(R, [`${R}/node_modules/x/index.js`, `${R}/web/node_modules/y.js`]), false);
});

test("one relevant path among noise is enough", () => {
  assert.equal(relevantChange(R, [`${R}/node_modules/x.js`, `${R}/README.md`]), true);
});

test("paths outside the repo are ignored, and an empty batch is nothing", () => {
  assert.equal(relevantChange(R, ["/w/other/a.ts", "/w/repo-two/a.ts"]), false);
  assert.equal(relevantChange(R, []), false);
});

test("the gap between live refreshes grows with how long git took", () => {
  assert.equal(liveGap(10), MIN_GAP_MS);
  assert.equal(liveGap(900), 3_600);
  assert.equal(liveGap(Number.NaN), MIN_GAP_MS);
});

test("agentsKey changes only when who works here or their status changes", () => {
  const a = agentsKey([{ name: "Claude", key: "claude", status: "working" }, { name: "Codex", key: "codex", status: "idle" }]);
  const b = agentsKey([{ name: "Codex", key: "codex", status: "idle" }, { name: "Claude", key: "claude", status: "working" }]);
  assert.equal(a, b, "order doesn't matter");
  assert.notEqual(a, agentsKey([{ name: "Claude", key: "claude", status: "done" }, { name: "Codex", key: "codex", status: "idle" }]));
  assert.equal(agentsKey([]), "");
});
