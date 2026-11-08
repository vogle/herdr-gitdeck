import { test } from "node:test";
import assert from "node:assert/strict";
import { blameArgs, parseBlame, fileLogArgs, reflogArgs, parseReflog, takeSideArgs } from "../src/core/inspect.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("blame reads a commit's file, never the work tree, and runs no programs", () => {
  assert.deepEqual(blameArgs(A, "src/x.ts"), ["blame", "--porcelain", "--no-textconv", "--no-progress", A, "--", "src/x.ts"]);
});

test("parseBlame gives each line its commit, author and time, details given once per commit", () => {
  const out = [
    `${A} 1 1 2`, "author Ann", "author-mail <a@x>", "author-time 100", "summary first", "filename f", "\tone",
    `${A} 2 2`, "\ttwo",
    `${B} 5 3 1`, "author Bob", "author-time 200", "summary second", "previous " + A + " f", "filename f", "\t",
    "",
  ].join("\n");
  const lines = parseBlame(out);
  assert.deepEqual(lines.map((l) => [l.hash, l.line, l.text, l.author, l.time, l.summary]), [
    [A, 1, "one", "Ann", 100, "first"],
    [A, 2, "two", "Ann", 100, "first"],
    [B, 3, "", "Bob", 200, "second"],
  ]);
  assert.deepEqual(lines.map((l) => l.first), [true, false, true], "a new block starts where the commit changes");
});

test("a file's history follows renames from the given commit", () => {
  const args = fileLogArgs(A, "f", 200);
  assert.deepEqual(args.slice(0, 3), ["log", "--no-show-signature", "--follow"]);
  assert.deepEqual(args.slice(-4), ["--max-count=200", A, "--", "f"]);
});

test("reflog: where HEAD has been, newest first", () => {
  assert.deepEqual(reflogArgs(100).slice(0, 3), ["log", "-g", "--no-show-signature"]);
  const out = `${A}\x1fHEAD@{0}\x1fcommit: two\x1f200\x1e\n${B}\x1fHEAD@{1}\x1fcheckout: moving from x to main\x1f100\x1e\n`;
  assert.deepEqual(parseReflog(out), [
    { hash: A, name: "HEAD@{0}", action: "commit: two", time: 200 },
    { hash: B, name: "HEAD@{1}", action: "checkout: moving from x to main", time: 100 },
  ]);
  assert.deepEqual(parseReflog("junk\x1e"), []);
});

test("a conflicted file takes one side whole", () => {
  assert.deepEqual(takeSideArgs("ours", ["a", "b"]), ["checkout", "--ours", "--", "a", "b"]);
  assert.deepEqual(takeSideArgs("theirs", ["a"]), ["checkout", "--theirs", "--", "a"]);
});
