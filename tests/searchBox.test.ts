import { test } from "node:test";
import assert from "node:assert/strict";
import { clearsOnEscape, showsClear } from "../src/core/searchBox.ts";

test("Esc empties a search box that holds text; on an empty one it goes on to the panel", () => {
  assert.equal(clearsOnEscape("escape", "306c5c3"), true);
  assert.equal(clearsOnEscape("escape", ""), false);
  assert.equal(clearsOnEscape("enter", "306c5c3"), false);
});

test("the × shows only while the box holds something, spaces included", () => {
  assert.equal(showsClear(""), false);
  assert.equal(showsClear("a"), true);
  assert.equal(showsClear("  "), true);
});
