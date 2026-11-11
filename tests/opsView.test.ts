import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyOps, forRepoOps, started, finished, confirmOps, holdOps, splitActions, toggleMore, startNaming, stopNaming, withOperation, withPlan, commitActions } from "../src/core/opsView.ts";
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
  assert.deepEqual(plain.map((a) => a.kind), ["checkout-commit", "branch", "tag", "cherry-pick", "revert", "merge", "rebase", "edit-after", "reset"]);
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

test("rare commit actions wait behind More; the common ones stay out", () => {
  const all = [
    { kind: "checkout-commit" }, { kind: "branch" }, { kind: "tag" }, { kind: "cherry-pick" }, { kind: "revert" },
    { kind: "merge" }, { kind: "rebase" }, { kind: "edit-after" }, { kind: "reset" },
    { kind: "checkout-branch", ref: "dev" }, { kind: "delete-branch", ref: "dev" },
  ] as const;
  const closed = splitActions(all, false);
  assert.deepEqual(closed.shown.map((a) => a.kind), ["checkout-commit", "branch", "revert", "checkout-branch"]);
  assert.equal(closed.hidden, 7);
  const open = splitActions(all, true);
  assert.equal(open.shown.length, all.length);
  assert.equal(open.hidden, 7, "More still says how many it holds");
  const stash = splitActions([{ kind: "stash-apply" }, { kind: "stash-pop" }, { kind: "stash-drop" }], false);
  assert.equal(stash.hidden, 0, "a stash's three actions all stay");
});

test("toggleMore opens and closes, and another repo starts closed", () => {
  const v = toggleMore(emptyOps("/r"));
  assert.equal(v.expanded, true);
  assert.equal(toggleMore(v).expanded, false);
  assert.equal(forRepoOps(v, "/other").expanded, false);
});
