import { test } from "node:test";
import assert from "node:assert/strict";
import { treeArgs, parseTree, blobArgs, blobText, loadTree, loadBlob, MAX_BLOB, lfsPointer, parseGitmodules } from "../src/core/tree.ts";

const A = "a".repeat(40);

test("the tree at a commit is listed whole, NUL-separated, with sizes", () => {
  assert.deepEqual(treeArgs(A), ["ls-tree", "-r", "-z", "--long", A]);
  const out = `100644 blob ${"1".repeat(40)}      12\tsrc/a.ts\x00120000 blob ${"2".repeat(40)}       3\tlink\x00160000 commit ${"3".repeat(40)}       -\tsub\x00`;
  assert.deepEqual(parseTree(out), [
    { path: "src/a.ts", size: 12, kind: "file", hash: "1".repeat(40) },
    { path: "link", size: 3, kind: "link", hash: "2".repeat(40) },
    { path: "sub", size: 0, kind: "submodule", hash: "3".repeat(40) },
  ]);
});

test("a file's content at a commit is read raw: no textconv, no filters", () => {
  assert.deepEqual(blobArgs(A, "src/a.ts"), ["cat-file", "blob", `${A}:src/a.ts`]);
});

test("blobText splits text into lines, and refuses binary or huge content", () => {
  assert.deepEqual(blobText("a\nb\n", 4), { lines: ["a", "b"], note: null });
  assert.deepEqual(blobText("x\x00y", 3), { lines: [], note: "Binary file (3 bytes)" });
  assert.equal(blobText("", MAX_BLOB + 1).note, `Too big to show (${MAX_BLOB + 1} bytes)`);
});

test("loadTree and loadBlob report errors as text and skip what can't be shown", async () => {
  const at = { cwd: "/r", on: null };
  const git = async (_t: unknown, args: string[]) => (args[0] === "ls-tree" ? `100644 blob ${"1".repeat(40)} 2\tf\x00` : "hi\n");
  assert.deepEqual((await loadTree(git, at, A)).files, [{ path: "f", size: 2, kind: "file", hash: "1".repeat(40) }]);
  assert.deepEqual(await loadBlob(git, at, A, { path: "f", size: 3, kind: "file", hash: "" }), { lines: ["hi"], note: null });
  assert.match((await loadBlob(git, at, A, { path: "s", size: 0, kind: "submodule", hash: A })).note ?? "", /Submodule/);
  assert.match((await loadBlob(git, at, A, { path: "b", size: MAX_BLOB + 1, kind: "file", hash: "" })).note ?? "", /Too big/);
  const failing = async () => {
    throw new Error("bad object");
  };
  assert.equal((await loadTree(failing, at, A)).error, "bad object");
  assert.equal((await loadBlob(failing, at, A, { path: "f", size: 1, kind: "file", hash: "" })).note, "bad object");
});

const OID = "b".repeat(64);
test("a Git LFS pointer is named as one: githerd never runs git-lfs to fetch it", () => {
  const ptr = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 12345\n`;
  assert.deepEqual(lfsPointer(ptr), { oid: OID, size: 12345 });
  assert.equal(lfsPointer("version 1\n"), null);
  assert.equal(lfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:short\nsize 1\n`), null);
  const v = blobText(ptr, ptr.length);
  assert.match(v.note ?? "", /Git LFS file: 12345 bytes, sha256:bbbbbbbbbbbb/);
  assert.match(v.note ?? "", /git-lfs isn't run/);
});

test("parseGitmodules reads each submodule's path and URL, ignoring the rest", () => {
  const text = [
    '[submodule "lib"]',
    "\tpath = vendor/lib",
    "\turl = https://github.com/a/lib.git",
    "\tupdate = !echo never-run",
    "# comment",
    '[submodule "x"]',
    "  url = git@github.com:a/x.git",
    "  path = x",
  ].join("\n");
  assert.deepEqual(parseGitmodules(text), new Map([["vendor/lib", "https://github.com/a/lib.git"], ["x", "git@github.com:a/x.git"]]));
  assert.deepEqual(parseGitmodules(""), new Map());
});

test("a submodule shows its recorded commit and URL, read from the commit's .gitmodules", async () => {
  const at = { cwd: "/r", on: null };
  const calls: string[][] = [];
  const git = async (_t: unknown, args: string[]) => {
    calls.push(args);
    return '[submodule "s"]\n\tpath = s\n\turl = https://x/s.git\n';
  };
  const note = (await loadBlob(git, at, A, { path: "s", size: 0, kind: "submodule", hash: "c".repeat(40) })).note ?? "";
  assert.match(note, /cccccccccc/);
  assert.match(note, /https:\/\/x\/s\.git/);
  assert.deepEqual(calls[0], ["cat-file", "blob", `${A}:.gitmodules`], "read raw from git's objects, never git submodule");
  const none = async () => {
    throw new Error("no .gitmodules");
  };
  assert.match((await loadBlob(none, at, A, { path: "s", size: 0, kind: "submodule", hash: A })).note ?? "", /no URL recorded/);
});
