import { test } from "node:test";
import assert from "node:assert/strict";
import { GitError, type Git } from "../src/core/git/runner.ts";
import type { Ref } from "../src/core/git/refs.ts";
import { baseBranch, compareArgs, loadCompare, parseCompare } from "../src/core/review.ts";

const ref = (name: string, kind: Ref["kind"] = "branch"): Ref => ({
  kind, full: kind === "remote" ? `refs/remotes/${name}` : `refs/heads/${name}`, name, hash: "a".repeat(40),
  upstream: null, ahead: 0, behind: 0, current: false,
});
const T = { cwd: "/r", on: null };

test("baseBranch picks main, then master, then their remote copies", () => {
  assert.equal(baseBranch([ref("feat"), ref("master"), ref("main")], "feat"), "main");
  assert.equal(baseBranch([ref("feat"), ref("master")], "feat"), "master");
  assert.equal(baseBranch([ref("feat"), ref("origin/main", "remote")], "feat"), "origin/main");
  assert.equal(baseBranch([ref("feat"), ref("develop")], "feat"), null, "no main line");
});

test("on the main line itself there is nothing to compare", () => {
  assert.equal(baseBranch([ref("main")], "main"), null);
  assert.equal(baseBranch([ref("main"), ref("origin/main", "remote")], "main"), null);
});

test("a detached HEAD still compares against main", () => {
  assert.equal(baseBranch([ref("main")], null), "main");
});

test("compareArgs counts both sides of base...HEAD", () => {
  assert.deepEqual(compareArgs("main"), ["rev-list", "--left-right", "--count", "main...HEAD", "--"]);
});

test("parseCompare reads behind (left) and ahead (right)", () => {
  assert.deepEqual(parseCompare("3\t5\n"), { behind: 3, ahead: 5 });
  assert.equal(parseCompare("garbage"), null);
});

test("loadCompare gives the counts with the base, or null when git fails", async () => {
  const ok: Git = async () => "0\t2\n";
  assert.deepEqual(await loadCompare(ok, T, "main"), { base: "main", behind: 0, ahead: 2 });
  const bad: Git = async (_t, a) => {
    throw new GitError("no", a, 128, "");
  };
  assert.equal(await loadCompare(bad, T, "main"), null);
});
