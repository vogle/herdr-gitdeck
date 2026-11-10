import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitDiffArgs,
  detailArgs,
  filesArgs,
  joinFiles,
  parseDetail,
  parseNameStatus,
  parseNumstat,
  untrackedDiffArgs,
  worktreeDiffArgs,
} from "../src/core/git/show.ts";
import { parseDiff, sameDiff } from "../src/core/git/diff.ts";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);
const SAFE = ["--no-ext-diff", "--no-textconv", "--no-color"];

test("detailArgs shows one commit's header without a diff", () => {
  const args = detailArgs(H1);
  assert.deepEqual(args.slice(0, 2), ["show", "-s"]);
  assert.ok(args.includes(H1));
  assert.ok(args.includes("--no-show-signature"));
});

test("parseDetail reads the header and the whole message", () => {
  const out = `${H1}\x1f${H2} ${H3}\x1fAnn\x1fann@x.io\x1f1700000000\x1fBo\x1fbo@x.io\x1f1700000500\x1fSubject line\n\nBody\x1fwith US\n`;
  assert.deepEqual(parseDetail(out), {
    hash: H1,
    parents: [H2, H3],
    author: "Ann",
    email: "ann@x.io",
    time: 1700000000,
    committer: "Bo",
    committerEmail: "bo@x.io",
    commitTime: 1700000500,
    message: "Subject line\n\nBody\x1fwith US",
  });
});

test("parseDetail of nothing is null", () => {
  assert.equal(parseDetail(""), null);
});

test("filesArgs compares with the first parent, or the empty tree at the root", () => {
  assert.deepEqual(filesArgs(H1, [H2, H3], "--name-status"), ["diff-tree", "-r", "-z", "-M", "--no-commit-id", ...SAFE, "--name-status", H2, H1]);
  assert.deepEqual(filesArgs(H1, [], "--numstat"), ["diff-tree", "-r", "-z", "-M", "--no-commit-id", ...SAFE, "--numstat", "--root", H1]);
});

test("parseNameStatus reads changes, renames and copies", () => {
  const out = "M\0src/a.ts\0R087\0old name.ts\0new name.ts\0A\0b.txt\0C100\0x\0y\0D\0gone\0";
  assert.deepEqual(parseNameStatus(out), [
    { status: "M", path: "src/a.ts", oldPath: null },
    { status: "R", path: "new name.ts", oldPath: "old name.ts" },
    { status: "A", path: "b.txt", oldPath: null },
    { status: "C", path: "y", oldPath: "x" },
    { status: "D", path: "gone", oldPath: null },
  ]);
  assert.deepEqual(parseNameStatus(""), []);
});

test("parseNumstat reads counts, binaries and renames", () => {
  const out = "3\t1\tsrc/a.ts\0-\t-\timg.png\0" + "2\t0\t\0old name.ts\0new name.ts\0";
  assert.deepEqual(parseNumstat(out), {
    "src/a.ts": { added: 3, deleted: 1, binary: false },
    "img.png": { added: 0, deleted: 0, binary: true },
    "new name.ts": { added: 2, deleted: 0, binary: false },
  });
});

test("joinFiles adds the counts to each change", () => {
  const files = joinFiles(parseNameStatus("M\0a\0A\0b\0"), parseNumstat("1\t2\ta\0"));
  assert.deepEqual(files, [
    { status: "M", path: "a", oldPath: null, added: 1, deleted: 2, binary: false },
    { status: "A", path: "b", oldPath: null, added: 0, deleted: 0, binary: false },
  ]);
});

test("commitDiffArgs patches one file against the first parent, both names for a rename", () => {
  assert.deepEqual(commitDiffArgs(H1, [H2], { path: "new", oldPath: "old" }), ["diff-tree", "-p", "-M", ...SAFE, H2, H1, "--", "old", "new"]);
  assert.deepEqual(commitDiffArgs(H1, [], { path: "a", oldPath: null }), ["diff-tree", "-p", "-M", ...SAFE, "--root", H1, "--", "a"]);
});

test("worktree diffs compare with HEAD (or the index before the first commit), untracked against nothing", () => {
  assert.deepEqual(worktreeDiffArgs("a b", true), ["diff", ...SAFE, "HEAD", "--", "a b"]);
  assert.deepEqual(worktreeDiffArgs("a", false), ["diff", ...SAFE, "--cached", "--", "a"]);
  assert.deepEqual(untrackedDiffArgs("n.txt"), ["diff", ...SAFE, "--no-index", "--", "/dev/null", "n.txt"]);
});

test("parseDiff numbers lines inside hunks and drops the headers", () => {
  const out = [
    "diff --git a/f b/f",
    "index 1..2 100644",
    "--- a/f",
    "+++ b/f",
    "@@ -10,3 +10,4 @@ function x() {",
    " keep",
    "-old",
    "+new",
    "+more",
    " end",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out).rows, [
    { kind: "hunk", old: null, new: null, text: "@@ -10,3 +10,4 @@ function x() {" },
    { kind: "ctx", old: 10, new: 10, text: "keep" },
    { kind: "del", old: 11, new: null, text: "old" },
    { kind: "add", old: null, new: 11, text: "new" },
    { kind: "add", old: null, new: 12, text: "more" },
    { kind: "ctx", old: 12, new: 13, text: "end" },
    { kind: "note", old: null, new: null, text: "No newline at end of file" },
  ]);
});

test("parseDiff says so for a binary file or no text change, and caps long diffs", () => {
  assert.deepEqual(parseDiff("diff --git a/i b/i\nBinary files a/i and b/i differ\n").rows, [
    { kind: "note", old: null, new: null, text: "Binary file changed" },
  ]);
  assert.deepEqual(parseDiff("").rows, [{ kind: "note", old: null, new: null, text: "No text changes" }]);
  const long = ["@@ -1,0 +1,10 @@", ...Array.from({ length: 10 }, (_, i) => `+l${i}`)].join("\n");
  const capped = parseDiff(long, 4);
  assert.equal(capped.rows.length, 4);
  assert.equal(capped.truncated, true);
  assert.equal(parseDiff(long).truncated, false);
});

test("parseDiff keeps a new file's mode lines out and handles a hunk without counts", () => {
  const out = "diff --git a/n b/n\nnew file mode 100644\nindex 0..1\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+only\n";
  assert.deepEqual(parseDiff(out).rows.slice(1), [{ kind: "add", old: null, new: 1, text: "only" }]);
});

test("sameDiff compares the rows and the cut, so an unchanged re-read can be skipped", () => {
  const a = parseDiff("@@ -1 +1 @@\n-a\n+b\n");
  assert.equal(sameDiff(a, parseDiff("@@ -1 +1 @@\n-a\n+b\n")), true);
  assert.equal(sameDiff(a, parseDiff("@@ -1 +1 @@\n-a\n+c\n")), false);
  assert.equal(sameDiff(a, { ...a, truncated: true }), false);
  assert.equal(sameDiff(a, parseDiff("")), false);
});
