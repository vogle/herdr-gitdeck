import { test } from "node:test";
import assert from "node:assert/strict";
import { countArgs, loadCounts } from "../src/core/lineCounts.ts";
import { GitError, type Git, type Target } from "../src/core/git/runner.ts";

const at: Target = { cwd: "/r", on: null };

test("countArgs asks for numstat of one side, never through a repo's diff programs", () => {
  assert.deepEqual(countArgs(false), ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "-z", "--numstat"]);
  assert.deepEqual(countArgs(true), ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "-z", "--numstat", "--cached"]);
});

test("loadCounts reads both sides; a side that fails just has no counts", async () => {
  const git: Git = async (_t, args) => {
    if (args.includes("--cached")) throw new GitError("bad", args, 128, "");
    return "3\t1\tsrc/a.ts\0-\t-\timg.png\0";
  };
  const counts = await loadCounts(git, at);
  assert.deepEqual(counts.staged, {});
  assert.deepEqual(counts.unstaged["src/a.ts"], { added: 3, deleted: 1, binary: false });
  assert.deepEqual(counts.unstaged["img.png"], { added: 0, deleted: 0, binary: true });
});
