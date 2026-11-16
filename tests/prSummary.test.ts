import { test } from "node:test";
import assert from "node:assert/strict";
import { checksText, prNumber, prRow, prState, checksTone } from "../src/core/forge/summary.ts";
import type { BranchPrState } from "../src/core/forge/index.ts";
import type { BranchPr } from "../src/core/forge/types.ts";

const pr = (over: Partial<BranchPr> = {}): BranchPr => ({
  number: 12,
  title: "t",
  state: "OPEN",
  draft: false,
  url: "https://github.com/o/r/pull/12",
  review: "",
  checks: { passed: 0, failed: 0, pending: 0 },
  target: "main",
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

test("the PR row under the header always holds its place and says where things stand", () => {
  const st = (o: Partial<BranchPrState>): BranchPrState => ({ pr: null, error: null, label: "MR", host: null, forge: "gitlab", ...o });
  assert.deepEqual(prRow(null, "feat"), { kind: "reading", text: "Reading origin…" }, "the forge isn't known yet: neither word");
  assert.deepEqual(prRow(null, "feat", false, "MR"), { kind: "reading", text: "Checking for an MR…" }, "the repo's forge is known from before");
  assert.deepEqual(prRow(null, "feat", false, "PR"), { kind: "reading", text: "Checking for a PR…" });
  assert.deepEqual(prRow(null, null), { kind: "reading", text: "Reading origin…" }, "a detached HEAD still reads which forge origin is");
  assert.deepEqual(prRow(st({}), null), { kind: "none", text: "Detached HEAD: no branch to have an MR" });
  assert.deepEqual(prRow(st({ label: "PR", forge: "github" }), null), { kind: "none", text: "Detached HEAD: no branch to have a PR" });
  assert.deepEqual(prRow(st({ host: "git.acme.dev", forge: null, label: "PR" }), "feat"), { kind: "ask", host: "git.acme.dev" });
  assert.deepEqual(prRow(st({ host: "git.acme.dev", forge: null, label: "PR" }), null), { kind: "ask", host: "git.acme.dev" });
  assert.deepEqual(prRow(st({ forge: null, label: "PR" }), "feat"), { kind: "none", text: "No GitHub or GitLab remote: no pull or merge requests here" });
  const one = pr();
  assert.deepEqual(prRow(st({ pr: one }), "main", true), { kind: "pr", pr: one });
  assert.deepEqual(prRow(st({ error: "dial tcp: i/o timeout" }), "feat"), { kind: "error", text: "Can't read the MR: dial tcp: i/o timeout" });
  assert.deepEqual(prRow(st({}), "feat"), { kind: "none", text: "No MR for this branch yet" });
  assert.deepEqual(prRow(st({}), "main", true), { kind: "none", text: "On the main line: MRs come from other branches" });
});
