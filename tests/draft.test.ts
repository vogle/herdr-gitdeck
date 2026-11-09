import { test } from "node:test";
import assert from "node:assert/strict";
import { draftMessage, followDraft } from "../src/core/draft.ts";

const f = (path: string, letter: string) => ({ path, letter, untracked: letter === "U" });

test("draftMessage names the staged files with a verb that fits them", () => {
  assert.equal(draftMessage([]), "");
  assert.equal(draftMessage([f("src/ui/header.ts", "M")]), "Update header.ts");
  assert.equal(draftMessage([f("src/ui/header.ts", "M"), f("src/main.ts", "M")]), "Update header.ts and main.ts");
  assert.equal(draftMessage([f("a/new.ts", "A"), f("b.ts", "U")]), "Add new.ts and b.ts");
  assert.equal(draftMessage([f("old.ts", "D")]), "Remove old.ts");
  assert.equal(draftMessage([f("x.ts", "R")]), "Rename x.ts");
  assert.equal(draftMessage([f("x.ts", "A"), f("y.ts", "D")]), "Update x.ts and y.ts");
});

test("draftMessage lists three names, then counts the rest", () => {
  const four = ["a.ts", "b.ts", "c.ts", "d.ts"].map((p) => f(p, "M"));
  assert.equal(draftMessage(four.slice(0, 3)), "Update a.ts, b.ts and c.ts");
  assert.equal(draftMessage(four), "Update a.ts, b.ts, c.ts and 1 more file");
  assert.equal(draftMessage([...four, f("e.ts", "M")]), "Update a.ts, b.ts, c.ts and 2 more files");
});

test("followDraft fills an empty box and keeps following its own draft", () => {
  assert.equal(followDraft("", "", "Update a.ts", false), "Update a.ts");
  assert.equal(followDraft("Update a.ts", "Update a.ts", "Update a.ts and b.ts", false), "Update a.ts and b.ts");
  assert.equal(followDraft("Update a.ts", "Update a.ts", "", false), "");
});

test("followDraft leaves what the person wrote, an amend, and an unchanged box alone", () => {
  assert.equal(followDraft("fix: login", "Update a.ts", "Update b.ts", false), null);
  assert.equal(followDraft("", "", "Update a.ts", true), null);
  assert.equal(followDraft("Update a.ts", "Update a.ts", "Update a.ts", false), null);
  assert.equal(followDraft("", "", "", false), null);
});
