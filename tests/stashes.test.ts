import { test } from "node:test";
import assert from "node:assert/strict";
import { STASH_PUSH, stashEntryLabel, stashKey, stashPrompt, stashStep } from "../src/core/stashes.ts";

test("stashPrompt counts the changes it would put aside", () => {
  assert.equal(stashPrompt(3), "Stash 3 changes?");
  assert.equal(stashPrompt(1), "Stash 1 change?");
});

test("stashKey names one entry's action, so only that row asks", () => {
  assert.equal(stashKey("pop", "stash@{0}"), "stash-pop:stash@{0}");
  assert.notEqual(stashKey("drop", "stash@{0}"), stashKey("drop", "stash@{1}"));
});

test("stashStep: pushing, popping and dropping ask once first; applying runs at once", () => {
  assert.equal(stashStep(null, STASH_PUSH), "ask");
  assert.equal(stashStep(STASH_PUSH, STASH_PUSH), "run");
  assert.equal(stashStep(null, stashKey("pop", "stash@{0}")), "ask");
  assert.equal(stashStep(stashKey("pop", "stash@{1}"), stashKey("pop", "stash@{0}")), "ask", "another row's question doesn't count");
  assert.equal(stashStep(stashKey("drop", "stash@{0}"), stashKey("drop", "stash@{0}")), "run");
  assert.equal(stashStep(null, stashKey("apply", "stash@{0}")), "run");
});

test("stashEntryLabel asks in place on the row being confirmed", () => {
  assert.equal(stashEntryLabel("apply", false), "Apply");
  assert.equal(stashEntryLabel("pop", false), "Pop");
  assert.equal(stashEntryLabel("pop", true), "Pop?");
  assert.equal(stashEntryLabel("drop", true), "Drop?");
});
