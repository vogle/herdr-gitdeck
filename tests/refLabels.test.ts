import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ref } from "../src/core/git/refs.ts";
import { refLabels } from "../src/core/graph/refLabels.ts";

const ref = (kind: Ref["kind"], name: string, current = false): Ref => ({
  kind, name, full: `refs/x/${name}`, hash: "h", upstream: null, ahead: 0, behind: 0, current,
});

test("a remote branch of the same name rides on its local branch's label", () => {
  const labels = refLabels([ref("branch", "main"), ref("remote", "origin/main")]);
  assert.deepEqual(labels, [
    { kind: "branch", current: false, parts: [{ kind: "branch", name: "main", text: "main" }, { kind: "remote", name: "origin/main", text: "origin" }] },
  ]);
});

test("a remote branch alone, and tags, get labels of their own", () => {
  const labels = refLabels([ref("tag", "v1.0"), ref("remote", "origin/dependabot")]);
  assert.deepEqual(labels.map((l) => [l.kind, l.parts.map((p) => p.text)]), [
    ["remote", ["origin/dependabot"]],
    ["tag", ["v1.0"]],
  ]);
});

test("the checked-out branch comes first and is marked current", () => {
  const labels = refLabels([ref("branch", "topic"), ref("branch", "work", true), ref("remote", "origin/work")]);
  assert.deepEqual(labels.map((l) => [l.parts[0]?.name, l.current, l.parts.length]), [
    ["work", true, 2],
    ["topic", false, 1],
  ]);
});

test("long names are cut with an ellipsis; the full name stays on the part", () => {
  const long = "feat/a-very-long-branch-name-here";
  const [label] = refLabels([ref("branch", long), ref("remote", `upstream-mirror-x/${long}`)]);
  assert.equal(label?.parts[0]?.text, "feat/a-very-long-bran…");
  assert.equal(label?.parts[0]?.name, long);
  assert.equal(label?.parts[1]?.text, "upstream-mi…");
});

test("each remote pairs once, even when two remotes share the branch name", () => {
  const labels = refLabels([ref("branch", "main"), ref("remote", "origin/main"), ref("remote", "fork/main")]);
  assert.deepEqual(labels.map((l) => l.parts.map((p) => p.text)), [["main", "origin", "fork"]]);
});
