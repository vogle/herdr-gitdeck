import { test } from "node:test";
import assert from "node:assert/strict";
import { treeArgs, parseTree, blobArgs, blobText, loadTree, loadBlob, MAX_BLOB } from "../src/core/tree.ts";

const A = "a".repeat(40);

test("the tree at a commit is listed whole, NUL-separated, with sizes", () => {
  assert.deepEqual(treeArgs(A), ["ls-tree", "-r", "-z", "--long", A]);
  const out = `100644 blob ${"1".repeat(40)}      12\tsrc/a.ts\x00120000 blob ${"2".repeat(40)}       3\tlink\x00160000 commit ${"3".repeat(40)}       -\tsub\x00`;
  assert.deepEqual(parseTree(out), [
    { path: "src/a.ts", size: 12, kind: "file" },
    { path: "link", size: 3, kind: "link" },
    { path: "sub", size: 0, kind: "submodule" },
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
  assert.deepEqual((await loadTree(git, at, A)).files, [{ path: "f", size: 2, kind: "file" }]);
  assert.deepEqual(await loadBlob(git, at, A, { path: "f", size: 3, kind: "file" }), { lines: ["hi"], note: null });
  assert.match((await loadBlob(git, at, A, { path: "s", size: 0, kind: "submodule" })).note ?? "", /submodule/);
  assert.match((await loadBlob(git, at, A, { path: "b", size: MAX_BLOB + 1, kind: "file" })).note ?? "", /Too big/);
  const failing = async () => {
    throw new Error("bad object");
  };
  assert.equal((await loadTree(failing, at, A)).error, "bad object");
  assert.equal((await loadBlob(failing, at, A, { path: "f", size: 1, kind: "file" })).note, "bad object");
});
