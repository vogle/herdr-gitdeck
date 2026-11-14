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

test("loadReview diffs HEAD against where it split from the base", async () => {
  const { loadReview } = await import("../src/core/review.ts");
  const M = "m".repeat(40);
  const H = "h".repeat(40);
  const calls: string[][] = [];
  const git: Git = async (_t, args) => {
    calls.push(args);
    if (args[0] === "merge-base") return `${M}\n`;
    if (args.includes("--name-status")) return "M\0src/a.ts\0A\0b.md\0";
    if (args.includes("--numstat")) return "3\t1\tsrc/a.ts\0" + "10\t0\tb.md\0";
    if (args.includes("--raw")) return `:100644 100644 ${M} ${H} M\0src/a.ts\0`;
    return "";
  };
  const r = await loadReview(git, T, "main", H);
  assert.deepEqual(calls[0], ["merge-base", "main", H]);
  assert.equal(r.error, null);
  assert.equal(r.mergeBase, M);
  assert.deepEqual(r.files.map((f) => [f.status, f.path, f.added, f.deleted]), [["M", "src/a.ts", 3, 1], ["A", "b.md", 10, 0]]);
  assert.ok(calls.some((c) => c[0] === "diff-tree" && c.at(-2) === M && c.at(-1) === H), "files between the split and HEAD");
  assert.equal(r.blobs.get("src/a.ts"), H, "each file's blob, to tell when it changed after being viewed");
  assert.ok(calls.some((c) => c.includes("--raw") && c.includes("--no-abbrev")));
});

test("loadReview reports git's error instead of a file list", async () => {
  const { loadReview } = await import("../src/core/review.ts");
  const bad: Git = async (_t, a) => {
    throw new GitError("fatal: no merge base", a, 1, "");
  };
  const r = await loadReview(bad, T, "main", "h".repeat(40));
  assert.deepEqual(r.files, []);
  assert.equal(r.blobs.size, 0);
  assert.match(r.error ?? "", /no merge base/);
});
