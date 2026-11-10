import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageArgs, unstageArgs, discardArgs, cleanArgs, commitArgs, applyArgs, lastMessageArgs,
  unstagedDiffArgs, stagedDiffArgs, lineRef, buildPatch, remember,
} from "../src/core/stage.ts";
import { parseDiff } from "../src/core/git/diff.ts";

const SAFE = ["--no-ext-diff", "--no-textconv", "--no-color"];

test("file-level commands, every path after --", () => {
  assert.deepEqual(stageArgs(["a", "-b"]), ["add", "--", "a", "-b"]);
  assert.deepEqual(unstageArgs(["a"], true), ["restore", "--staged", "--", "a"]);
  assert.deepEqual(unstageArgs(["a"], false), ["rm", "--cached", "-q", "--", "a"]);
  assert.deepEqual(discardArgs(["a"]), ["restore", "--worktree", "--", "a"]);
  assert.deepEqual(cleanArgs(["n"]), ["clean", "-f", "-q", "--", "n"]);
  assert.deepEqual(unstagedDiffArgs("a"), ["diff", ...SAFE, "--", "a"]);
  assert.deepEqual(stagedDiffArgs("a"), ["diff", ...SAFE, "--cached", "--", "a"]);
});

test("commit and amend take the message as an argument", () => {
  assert.deepEqual(commitArgs("Fix it\n\nBody", false), ["commit", "-q", "-m", "Fix it\n\nBody"]);
  assert.deepEqual(commitArgs("Again", true), ["commit", "-q", "--amend", "-m", "Again"]);
  assert.deepEqual(lastMessageArgs(), ["log", "-1", "--no-show-signature", "--format=%B"]);
});

test("applyArgs applies a patch file to the index, reversed to unstage", () => {
  assert.deepEqual(applyArgs("/g/gitdeck.patch", false), ["apply", "--cached", "--recount", "--whitespace=nowarn", "/g/gitdeck.patch"]);
  assert.deepEqual(applyArgs("/g/p", true), ["apply", "--cached", "--recount", "--whitespace=nowarn", "--reverse", "/g/p"]);
});

const RAW = [
  "diff --git a/f b/f",
  "index 1..2 100644",
  "--- a/f",
  "+++ b/f",
  "@@ -1,4 +1,4 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  " four",
  "@@ -10,2 +10,3 @@ fn",
  " ten",
  "+new",
  " eleven",
  "",
].join("\n");

test("lineRef maps a diff row to its hunk and line inside it", () => {
  const rows = parseDiff(RAW).rows;
  assert.deepEqual(lineRef(rows, 0), { hunk: 0, line: -1 });
  assert.deepEqual(lineRef(rows, 2), { hunk: 0, line: 1 });
  assert.deepEqual(lineRef(rows, 7), { hunk: 1, line: 0 });
  assert.deepEqual(lineRef(rows, 8), { hunk: 1, line: 1 });
  assert.equal(lineRef(rows, 99), null);
  assert.equal(lineRef(parseDiff("").rows, 0), null);
});

test("buildPatch with a whole hunk keeps the file header and that hunk only", () => {
  const patch = buildPatch(RAW, [{ hunk: 1, lines: null }], false);
  assert.equal(patch, ["diff --git a/f b/f", "index 1..2 100644", "--- a/f", "+++ b/f", "@@ -10,2 +10,3 @@ fn", " ten", "+new", " eleven", ""].join("\n"));
});

test("buildPatch with some lines: unpicked removals stay as context, unpicked additions go", () => {
  // Pick only the removal of "two": "TWO" is not added.
  const patch = buildPatch(RAW, [{ hunk: 0, lines: new Set([1]) }], false);
  assert.equal(patch?.split("\n").slice(4).join("\n"), ["@@ -1,4 +1,3 @@", " one", "-two", " three", " four", ""].join("\n"));
});

test("buildPatch reversed (unstaging): unpicked additions stay as context, unpicked removals go", () => {
  const patch = buildPatch(RAW, [{ hunk: 0, lines: new Set([2]) }], true);
  assert.equal(patch?.split("\n").slice(4).join("\n"), ["@@ -1,3 +1,4 @@", " one", "+TWO", " three", " four", ""].join("\n"));
});

test("buildPatch keeps a no-newline marker with its line, and is null when nothing changes", () => {
  const raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n";
  const p = buildPatch(raw, [{ hunk: 0, lines: new Set([0, 1]) }], false);
  assert.equal(p?.split("\n").slice(3).join("\n"), "@@ -1,1 +1,0 @@\n-a\n\\ No newline at end of file\n");
  assert.equal(buildPatch(RAW, [{ hunk: 0, lines: new Set([0]) }], false), null, "only context picked");
  assert.equal(buildPatch(RAW, [{ hunk: 5, lines: null }], false), null);
  assert.equal(buildPatch("", [{ hunk: 0, lines: null }], false), null);
});

test("remember keeps recent messages, newest first, without repeats", () => {
  assert.deepEqual(remember(["b", "a"], "a"), ["a", "b"]);
  assert.deepEqual(remember(["a"], "  "), ["a"]);
  assert.deepEqual(remember(["1", "2", "3"], "4", 3), ["4", "1", "2"]);
  assert.deepEqual(remember([], " x \n"), ["x"]);
});
