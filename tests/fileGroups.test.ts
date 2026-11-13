import { test } from "node:test";
import assert from "node:assert/strict";
import { allOpen, folderKeys, folderTree, isOpen, matching, setAll, type FolderNode } from "../src/core/fileGroups.ts";

const f = (path: string) => ({ path });

/** Each folder row as "label count new?", indented two spaces per level, files by path. */
function outline(node: FolderNode<{ path: string }>, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...node.folders.flatMap((d) => [`${pad}${d.label} ${d.all.length}${d.isNew ? " new" : ""}`, ...outline(d, depth + 1)]),
    ...node.files.map((x) => `${pad}${x.path}`),
  ];
}

test("files sit in a folder tree: folders first in path order, then files in their order", () => {
  const tree = folderTree([f("src/ui/b.ts"), f("README.md"), f("src/core/a.ts"), f("src/ui/a.ts"), f("src/main.ts")]);
  assert.deepEqual(outline(tree), [
    "src/ 4",
    "  core/ 1",
    "    src/core/a.ts",
    "  ui/ 2",
    "    src/ui/b.ts",
    "    src/ui/a.ts",
    "  src/main.ts",
    "README.md",
  ]);
});

test("a folder holding only one folder shares its row", () => {
  const tree = folderTree([f(".claude/rules/moai/core/a.md"), f(".claude/rules/moai/b.md"), f("a/b/c/x.ts")]);
  assert.deepEqual(outline(tree), [
    ".claude/rules/moai/ 2",
    "  core/ 1",
    "    .claude/rules/moai/core/a.md",
    "  .claude/rules/moai/b.md",
    "a/b/c/ 1",
    "  a/b/c/x.ts",
  ]);
  assert.equal(tree.folders[0]?.folder, ".claude/rules/moai/");
});

test("a wholly new folder keeps its own row; everything in it is new, its parent is not", () => {
  const tree = folderTree([f("docs/a.md"), f("docs/new/x/1.md"), f("docs/new/x/2.md"), f(".claude/rules/moai/c.md")], ["docs/new/", ".claude/"]);
  assert.deepEqual(outline(tree), [
    ".claude/ 1 new",
    "  rules/moai/ 1 new",
    "    .claude/rules/moai/c.md",
    "docs/ 3",
    "  new/ 2 new",
    "    x/ 2 new",
    "      docs/new/x/1.md",
    "      docs/new/x/2.md",
    "  docs/a.md",
  ]);
});

test("an untracked folder entry sits in its parent folder", () => {
  assert.deepEqual(outline(folderTree([f("docs/new/")])), ["docs/ 1", "  docs/new/"]);
});

test("no files, an empty tree", () => {
  const tree = folderTree([]);
  assert.deepEqual([tree.folder, tree.folders, tree.files, tree.all], ["", [], [], []]);
});

test("a folder starts open, a wholly new one and everything in it folded; a flip is per section", () => {
  const nf = [".claude/"];
  assert.equal(isOpen("src/", new Set(), "u", nf), true);
  assert.equal(isOpen("src/", new Set(["u:src/"]), "u", nf), false);
  assert.equal(isOpen("src/", new Set(["u:src/"]), "s", nf), true);
  assert.equal(isOpen(".claude/", new Set(), "u", nf), false);
  assert.equal(isOpen(".claude/x/", new Set(), "u", nf), false);
  assert.equal(isOpen(".claude/x/", new Set(["u:.claude/x/"]), "u", nf), true);
});

test("folderKeys names every folder row at every depth, but not the repo's top", () => {
  const files = [f("README.md"), f("src/a.ts"), f("src/ui/b.ts"), f(".claude/x/1.md"), f(".claude/top.md")];
  assert.deepEqual(folderKeys("u", files, [".claude/"]), ["u:.claude/", "u:.claude/x/", "u:src/", "u:src/ui/"]);
});

test("setAll opens or folds every folder in a section, leaving the other section's flips", () => {
  const files = [f("src/a.ts"), f(".claude/x/1.md")];
  const nf = [".claude/"];
  const open = setAll(new Set(["u:src/", "s:src/"]), "u", files, nf, true);
  assert.deepEqual([...open].sort(), ["s:src/", "u:.claude/", "u:.claude/x/"]);
  assert.equal(allOpen(open, "u", files, nf), true);
  const folded = setAll(open, "u", files, nf, false);
  assert.deepEqual([...folded].sort(), ["s:src/", "u:src/"]);
  assert.equal(allOpen(folded, "u", files, nf), false);
  assert.equal(allOpen(new Set(), "u", [f("a.ts")], nf), true);
});

test("matching keeps files whose path holds the text, ignoring case; no text keeps all", () => {
  const files = [f("src/UI/Changes.ts"), f("README.md")];
  assert.deepEqual(matching(files, " changes ").map((x) => x.path), ["src/UI/Changes.ts"]);
  assert.deepEqual(matching(files, "").length, 2);
});
