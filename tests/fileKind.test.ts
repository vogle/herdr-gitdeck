import { test } from "node:test";
import assert from "node:assert/strict";
import { fileKind } from "../src/core/fileKind.ts";

test("a file's kind comes from its extension, ignoring case and folders", () => {
  assert.equal(fileKind("src/core/fileGroups.ts"), "code");
  assert.equal(fileKind("tests/fileGroups.test.ts"), "code");
  assert.equal(fileKind("App.TSX"), "code");
  assert.equal(fileKind("docs/README.md"), "text");
  assert.equal(fileKind("notes.txt"), "text");
  assert.equal(fileKind("package.json"), "json");
  assert.equal(fileKind("ci.yaml"), "config");
  assert.equal(fileKind("Cargo.toml"), "config");
  assert.equal(fileKind("pnpm-lock.yaml"), "lock");
  assert.equal(fileKind("logo.PNG"), "image");
  assert.equal(fileKind("scripts/dev-install.sh"), "terminal");
});

test("some files are known by their whole name", () => {
  assert.equal(fileKind(".gitignore"), "config");
  assert.equal(fileKind("sub/.claudeignore"), "config");
  assert.equal(fileKind(".worktreeinclude"), "config");
  assert.equal(fileKind(".env"), "lock");
  assert.equal(fileKind(".env.local"), "lock");
  assert.equal(fileKind("Dockerfile"), "config");
  assert.equal(fileKind("Makefile"), "terminal");
});

test("anything else, or a name with no extension, is a plain file", () => {
  assert.equal(fileKind("LICENSE"), "file");
  assert.equal(fileKind("data.bin"), "file");
  assert.equal(fileKind("trailing."), "file");
  assert.equal(fileKind(""), "file");
});

test("an ignore pattern's icon: a folder, a known file, or a plain file for a wildcard", async () => {
  const { patternKind } = await import("../src/core/fileKind.ts");
  assert.equal(patternKind("/.moai/"), "folder");
  assert.equal(patternKind(".claude/"), "folder");
  assert.equal(patternKind("/.mcp.json"), "json");
  assert.equal(patternKind(".env"), "lock");
  assert.equal(patternKind("*.log"), "file");
  assert.equal(patternKind("build/*.ts"), "file");
  assert.equal(patternKind("cache?/"), "file");
});
