import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyHerd,
  withRepos,
  select,
  togglePicker,
  closePicker,
  withStatus,
  groupRepos,
  selectedRepo,
} from "../src/core/herd.ts";
import { parseStatus } from "../src/core/git/status.ts";

const subs = [
  { path: "/h/a", name: "a", group: "" },
  { path: "/h/libs/c", name: "c", group: "libs" },
];

test("withRepos puts the root first, selects the focused repo, and never mutates", () => {
  const s0 = emptyHerd();
  const s1 = withRepos(s0, { root: "/h", rootIsRepo: true, focused: "/h/a", repos: subs });
  assert.notEqual(s1, s0);
  assert.equal(s0.root, null);
  assert.deepEqual(
    s1.repos.map((r) => [r.path, r.isRoot]),
    [
      ["/h", true],
      ["/h/a", false],
      ["/h/libs/c", false],
    ],
  );
  assert.equal(s1.selected, "/h/a");
  assert.equal(selectedRepo(s1)?.name, "a");
});

test("a root that isn't a repo is left out, and the first repo is selected", () => {
  const s = withRepos(emptyHerd(), { root: "/h", rootIsRepo: false, focused: null, repos: subs });
  assert.deepEqual(s.repos.map((r) => r.path), ["/h/a", "/h/libs/c"]);
  assert.equal(s.selected, "/h/a");
});

test("a rescan of the same folder keeps the person's pick while that repo is still there", () => {
  const s1 = select(withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: "/h/a", repos: subs }), "/h/libs/c");
  const s2 = withRepos(s1, { root: "/h", rootIsRepo: true, focused: "/h/a", repos: subs });
  assert.equal(s2.selected, "/h/libs/c");
  const s3 = withRepos(s1, { root: "/h", rootIsRepo: true, focused: "/h/a", repos: [subs[0]!] });
  assert.equal(s3.selected, "/h/a");
});

test("moving focus to another repo of the same herd shows that repo", () => {
  const s1 = select(withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: "/h/a", repos: subs }), "/h");
  const s2 = withRepos(s1, { root: "/h", rootIsRepo: true, focused: "/h/libs/c", repos: subs }, { followFocus: true });
  assert.equal(s2.selected, "/h/libs/c");
  // Focus on a folder of the herd that isn't in any sub-repo keeps the pick.
  const s3 = withRepos(s1, { root: "/h", rootIsRepo: false, focused: null, repos: subs }, { followFocus: true });
  assert.equal(s3.selected, "/h/a");
});

test("a different root drops the old pick and statuses", () => {
  const s1 = withStatus(
    withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: null, repos: [] }),
    "/h",
    { status: parseStatus(""), error: null },
  );
  const s2 = withRepos(s1, { root: "/other", rootIsRepo: true, focused: null, repos: [] });
  assert.equal(s2.selected, "/other");
  assert.deepEqual(s2.statuses, {});
});

test("select ignores unknown repos and closes the picker", () => {
  const s1 = togglePicker(withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: null, repos: subs }));
  assert.equal(s1.picking, true);
  assert.equal(select(s1, "/nope"), s1);
  const s2 = select(s1, "/h/a");
  assert.equal(s2.selected, "/h/a");
  assert.equal(s2.picking, false);
});

test("togglePicker and closePicker", () => {
  const s = emptyHerd();
  assert.equal(togglePicker(s).picking, true);
  assert.equal(togglePicker(togglePicker(s)).picking, false);
  assert.equal(closePicker(s), s);
  assert.equal(closePicker(togglePicker(s)).picking, false);
});

test("withStatus records a result per repo without touching the others", () => {
  const s1 = withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: null, repos: subs });
  const s2 = withStatus(s1, "/h/a", { status: null, error: "boom" });
  assert.deepEqual(s2.statuses["/h/a"], { status: null, error: "boom" });
  assert.equal(s1.statuses["/h/a"], undefined);
});

test("groupRepos keeps order and groups by folder, root and direct children together", () => {
  const s = withRepos(emptyHerd(), { root: "/h", rootIsRepo: true, focused: null, repos: subs });
  assert.deepEqual(
    groupRepos(s.repos).map((g) => [g.group, g.repos.map((r) => r.name)]),
    [
      ["", ["h", "a"]],
      ["libs", ["c"]],
    ],
  );
});

test("selectedRepo of an empty herd is null", () => {
  assert.equal(selectedRepo(emptyHerd()), null);
});
