import { test } from "node:test";
import assert from "node:assert/strict";
import { checksText, prNumber, prState, checksTone } from "../src/core/forge/summary.ts";
import type { BranchPr } from "../src/core/forge/types.ts";

const pr = (over: Partial<BranchPr> = {}): BranchPr => ({
  number: 12,
  title: "t",
  state: "OPEN",
  draft: false,
  url: "https://github.com/o/r/pull/12",
  review: "",
  checks: { passed: 0, failed: 0, pending: 0 },
  ...over,
});

test("a PR is #n, a GitLab MR is !n", () => {
  assert.equal(prNumber(pr(), "PR"), "PR #12");
  assert.equal(prNumber(pr({ number: 3 }), "MR"), "MR !3");
});

test("the state reads draft first, then the review's verdict", () => {
  assert.equal(prState(pr()), "OPEN");
  assert.equal(prState(pr({ draft: true })), "DRAFT");
  assert.equal(prState(pr({ review: "APPROVED" })), "OPEN · approved");
  assert.equal(prState(pr({ review: "CHANGES_REQUESTED" })), "OPEN · changes requested");
  assert.equal(prState(pr({ state: "MERGED" })), "MERGED");
});

test("checks say what passed, failed and still runs", () => {
  assert.equal(checksText({ passed: 0, failed: 0, pending: 0 }), "no checks");
  assert.equal(checksText({ passed: 5, failed: 0, pending: 0 }), "checks 5✓");
  assert.equal(checksText({ passed: 3, failed: 1, pending: 2 }), "checks 3✓ 1✗ 2…");
});

test("a failure outweighs a running check, which outweighs passes", () => {
  assert.equal(checksTone({ passed: 3, failed: 1, pending: 2 }), "failed");
  assert.equal(checksTone({ passed: 3, failed: 0, pending: 2 }), "pending");
  assert.equal(checksTone({ passed: 3, failed: 0, pending: 0 }), "passed");
  assert.equal(checksTone({ passed: 0, failed: 0, pending: 0 }), "none");
});
