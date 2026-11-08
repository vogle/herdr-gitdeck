import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, dirname, isInside, relative, trimSlash } from "../src/core/paths.ts";

test("trimSlash drops trailing slashes but keeps the root", () => {
  assert.equal(trimSlash("/a/b/"), "/a/b");
  assert.equal(trimSlash("/a/b//"), "/a/b");
  assert.equal(trimSlash("/"), "/");
});

test("dirname and basename", () => {
  assert.equal(dirname("/a/b/c"), "/a/b");
  assert.equal(dirname("/a"), "/");
  assert.equal(dirname("/"), "/");
  assert.equal(basename("/a/b/c/"), "c");
  assert.equal(basename("/"), "/");
});

test("isInside is true for the folder itself and its children only", () => {
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b/c", "/a/b"), true);
  assert.equal(isInside("/a/bc", "/a/b"), false);
  assert.equal(isInside("/a", "/a/b"), false);
  assert.equal(isInside("/x", "/"), true);
});

test("relative gives the path below a folder", () => {
  assert.equal(relative("/a", "/a/b/c"), "b/c");
  assert.equal(relative("/a", "/a"), "");
  assert.equal(relative("/a/", "/a/b"), "b");
  assert.equal(relative("/", "/a/b"), "a/b");
});
