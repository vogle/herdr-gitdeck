import { test } from "node:test";
import assert from "node:assert/strict";
import { contextOf, sameContext } from "../src/core/context.ts";

const spaces = [
  { id: "s1", active: false, folder: "/one", machine: null, tabs: [{ id: "t1", active: true }] },
  { id: "s2", active: true, folder: "/two", machine: "box", tabs: [{ id: "t2", active: true }] },
];

test("the focused terminal's folder wins, on its space's machine", () => {
  const c = contextOf({ space: "s2", tab: "t2", cwd: "/two/sub" }, [], spaces);
  assert.deepEqual(c, { cwd: "/two/sub", on: "box" });
});

test("a focused mod pane (no cwd) falls back to a terminal in the same tab", () => {
  const panes = [
    { tab: "t9", terminal: "x", cwd: "/elsewhere" },
    { tab: "t2", terminal: null, cwd: null },
    { tab: "t2", terminal: "t2a", cwd: "/two/repo" },
  ];
  assert.deepEqual(contextOf({ space: "s2", tab: "t2", cwd: null }, panes, spaces), { cwd: "/two/repo", on: "box" });
});

test("with no terminal folder anywhere in the tab, the space's folder is used", () => {
  assert.deepEqual(contextOf({ space: "s1", tab: "t1", cwd: null }, [], spaces), { cwd: "/one", on: null });
});

test("nothing focused: the active space", () => {
  assert.deepEqual(contextOf(null, [], spaces), { cwd: "/two", on: "box" });
});

test("no folder at all gives null", () => {
  assert.equal(contextOf(null, [], [{ id: "s", active: true, folder: "", machine: null }]), null);
  assert.equal(contextOf(null, [], []), null);
});

test("sameContext compares folder and machine", () => {
  assert.equal(sameContext({ cwd: "/a", on: null }, { cwd: "/a", on: null }), true);
  assert.equal(sameContext({ cwd: "/a", on: null }, { cwd: "/a", on: "m" }), false);
  assert.equal(sameContext(null, null), true);
  assert.equal(sameContext(null, { cwd: "/a", on: null }), false);
});
