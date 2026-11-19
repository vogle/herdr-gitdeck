import { test } from "node:test";
import assert from "node:assert/strict";
import { treeRows, toggleFolder, sizeText } from "../src/core/treeRows.ts";
import type { TreeFile } from "../src/core/tree.ts";

const f = (path: string, size = 1): TreeFile => ({ path, size, kind: "file", hash: "h" });
const files = [f(".gitignore"), f("README.md"), f("src/a.ts"), f("src/ui/b.ts"), f("src/ui/c.ts"), f("docs/deep/x.md")];
const show = (rows: ReturnType<typeof treeRows>) => rows.map((r) => (r.kind === "folder" ? `${"  ".repeat(r.depth)}${r.open ? "v" : ">"} ${r.label} ${r.count}` : `${"  ".repeat(r.depth)}${r.name} #${r.index}`));

test("folders start folded and come before the top's files", () => {
  assert.deepEqual(show(treeRows(files, new Set())), ["> docs/deep/ 1", "> src/ 3", ".gitignore #0", "README.md #1"]);
});

test("an open folder shows its folders, then its files, one step in", () => {
  assert.deepEqual(show(treeRows(files, new Set(["src/"]))), ["> docs/deep/ 1", "v src/ 3", "  > ui/ 2", "  a.ts #2", ".gitignore #0", "README.md #1"]);
  assert.deepEqual(show(treeRows(files, new Set(["src/", "src/ui/"]))).slice(2, 5), ["  v ui/ 2", "    b.ts #3", "    c.ts #4"]);
});

test("a folder inside a folded one stays hidden, even when it is open", () => {
  assert.equal(show(treeRows(files, new Set(["src/ui/"]))).some((r) => r.includes("b.ts")), false);
});

test("toggleFolder opens a folded folder and folds an open one, as a new set", () => {
  const open = new Set(["src/"]);
  const next = toggleFolder(open, "docs/deep/");
  assert.deepEqual([...next].sort(), ["docs/deep/", "src/"]);
  assert.deepEqual([...toggleFolder(next, "src/")], ["docs/deep/"]);
  assert.deepEqual([...open], ["src/"], "the old set is left as it was");
});

test("sizeText reads like a file browser", () => {
  assert.equal(sizeText(0), "0 B");
  assert.equal(sizeText(1023), "1023 B");
  assert.equal(sizeText(8656), "8.5 KB");
  assert.equal(sizeText(1536 * 1024), "1.5 MB");
  assert.equal(sizeText(200 * 1024), "200 KB");
});
