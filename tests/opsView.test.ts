import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyOps, forRepoOps, started, finished, confirmOps, holdOps, openMenu, placeMenu, closeMenu, chooseFromMenu, fitMenu, startNaming, stopNaming, withOperation, withPlan, commitActions } from "../src/core/opsView.ts";
import type { Ref } from "../src/core/git/refs.ts";

const H = "a".repeat(40);
const ref = (kind: Ref["kind"], name: string, current = false): Ref => ({ kind, full: `refs/x/${name}`, name, hash: H, upstream: null, ahead: 0, behind: 0, current });

test("an action runs once at a time and ends with its error or a notice", () => {
  let v = started(emptyOps("/r"), "Fetch");
  assert.equal(v.busy, "Fetch");
  assert.equal(started(v, "Pull"), v, "busy: the second is refused");
  v = finished(v, null, "Fetched");
  assert.deepEqual([v.busy, v.error, v.notice], [null, null, "Fetched"]);
  v = finished(started(v, "Push"), "rejected", "Pushed");
  assert.deepEqual([v.error, v.notice], ["rejected", null]);
});

test("confirm and naming", () => {
  let v = confirmOps(emptyOps("/r"), "reset-hard");
  assert.equal(v.confirm, "reset-hard");
  v = startNaming(v, "tag", H);
  assert.deepEqual(v.naming, { kind: "tag", at: H });
  assert.equal(v.confirm, null);
  assert.equal(stopNaming(v).naming, null);
  assert.equal(finished(started(confirmOps(v, "x"), "y"), null, null).confirm, null);
});

test("another repo starts over, and the operation under way is kept", () => {
  const v = withOperation(confirmOps(emptyOps("/r"), "k"), "merge");
  assert.equal(v.operation, "merge");
  assert.equal(forRepoOps(v, "/r"), v);
  assert.deepEqual(forRepoOps(v, "/s"), emptyOps("/s"));
});

test("commitActions offers what fits the commit and the refs on it", () => {
  const plain = commitActions({ hash: H, parents: 1, refs: [], stash: null, head: "b".repeat(40), branch: "main" });
  assert.deepEqual(plain.map((a) => a.kind), ["checkout-commit", "branch", "tag", "cherry-pick", "revert", "merge", "rebase", "squash-later", "reset"]);
  const onHead = commitActions({ hash: H, parents: 1, refs: [ref("branch", "main", true)], stash: null, head: H, branch: "main" });
  assert.deepEqual(onHead.map((a) => a.kind), ["branch", "tag", "revert", "reset"], "HEAD itself: no checkout, pick, merge or rebase");
  const withRefs = commitActions({ hash: H, parents: 2, refs: [ref("branch", "dev"), ref("remote", "origin/x"), ref("tag", "v1")], stash: null, head: "b".repeat(40), branch: "main" });
  assert.deepEqual(
    withRefs.filter((a) => a.ref).map((a) => `${a.kind}:${a.ref}`),
    ["checkout-branch:dev", "merge:dev", "rebase:dev", "delete-branch:dev", "checkout-remote:origin/x", "merge:origin/x", "rebase:origin/x"],
  );
  const stash = commitActions({ hash: H, parents: 2, refs: [], stash: "stash@{0}", head: "b".repeat(40), branch: "main" });
  assert.deepEqual(stash.map((a) => a.kind), ["stash-apply", "stash-pop", "stash-drop"]);
  const detached = commitActions({ hash: H, parents: 1, refs: [], stash: null, head: "b".repeat(40), branch: null });
  assert.ok(!detached.some((a) => a.kind === "merge" || a.kind === "rebase"), "no branch to merge into");
});

test("withPlan opens and closes the rebase editor and clears a pending click", () => {
  const plan = { base: null, steps: [] };
  const v = withPlan(confirmOps(emptyOps("/r"), "k"), plan);
  assert.equal(v.plan, plan);
  assert.equal(v.confirm, null);
  assert.equal(withPlan(v, null).plan, null);
});

test("an action held for a working agent waits until run or dismissed", () => {
  const held = holdOps(emptyOps("/r"), "Claude is working here");
  assert.equal(held.held, "Claude is working here");
  assert.equal(started(held, "Merging").held, null, "running it clears the hold");
  assert.equal(finished(held, null, null).held, null, "dismissing clears it");
  assert.equal(holdOps(confirmOps(emptyOps("/r"), "rebase:x"), "t").confirm, null, "a pending second click is dropped");
});

test("a right-click opens the menu on that commit; the pane's press then places it once", () => {
  const open = openMenu(confirmOps(emptyOps("/r"), "rebase:x"), "abc");
  assert.deepEqual(open.menu, { hash: "abc", x: null, y: null });
  assert.equal(open.confirm, null, "a pending second click is dropped");
  const placed = placeMenu(open, 10, 20);
  assert.deepEqual(placed.menu, { hash: "abc", x: 10, y: 20 });
  assert.equal(placeMenu(placed, 99, 99), placed, "a later press doesn't move it");
  assert.equal(placeMenu(emptyOps("/r"), 1, 2).menu, null, "no menu, nothing to place");
  assert.equal(closeMenu(placed).menu, null);
  assert.equal(forRepoOps(placed, "/other").menu, null, "another repo starts closed");
});

test("an action picked in the menu closes it and keeps acting on that commit", () => {
  const picked = chooseFromMenu(placeMenu(openMenu(emptyOps("/r"), "abc"), 1, 2));
  assert.equal(picked.menu, null);
  assert.equal(picked.subject, "abc");
  assert.equal(chooseFromMenu(picked).subject, "abc", "without a menu the subject stays");
});

test("fitMenu keeps the menu inside the pane, flipping it above or left of the press", () => {
  assert.deepEqual(fitMenu(10, 10, { width: 400, height: 600 }, 180, 200), { x: 10, y: 10 });
  assert.deepEqual(fitMenu(10, 500, { width: 400, height: 600 }, 180, 200), { x: 10, y: 300 }, "opens above near the bottom");
  assert.deepEqual(fitMenu(300, 10, { width: 400, height: 600 }, 180, 200), { x: 220, y: 10 }, "slides left near the right edge");
  assert.deepEqual(fitMenu(10, 50, { width: 100, height: 100 }, 180, 200), { x: 0, y: 0 }, "never above or left of the pane");
});
