import { test } from "node:test";
import assert from "node:assert/strict";
import { findRows, stepMatch } from "../src/core/diffFind.ts";

const rows = [{ text: "@@ -1,3 +1,3 @@" }, { text: "const Foo = 1" }, { text: "  return foo()" }, { text: "bar" }];

test("findRows lists the rows holding the words, ignoring case", () => {
  assert.deepEqual(findRows(rows, "foo"), [1, 2]);
  assert.deepEqual(findRows(rows, "FOO()"), [2]);
  assert.deepEqual(findRows(rows, "nothing"), []);
  assert.deepEqual(findRows(rows, "   "), [], "blank finds nothing");
});

test("stepMatch goes to the next or previous match and wraps around", () => {
  assert.equal(stepMatch(3, 0, false), 1);
  assert.equal(stepMatch(3, 2, false), 0);
  assert.equal(stepMatch(3, 0, true), 2);
  assert.equal(stepMatch(3, 1, true), 0);
  assert.equal(stepMatch(0, 0, false), 0, "no matches stays put");
});
