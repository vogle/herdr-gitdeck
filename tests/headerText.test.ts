import { test } from "node:test";
import assert from "node:assert/strict";
import { changesTabLabel, conflictWarning } from "../src/core/headerText.ts";
import { agentChips, repoAgents } from "../src/core/repoAgents.ts";

const status = (kinds: string[]) => ({
  entries: kinds.map((kind, i) => ({ kind, index: "M", worktree: ".", path: `f${i}`, origPath: null })),
});

test("the Changes tab counts changed files and new ones apart", () => {
  assert.equal(changesTabLabel(null), "Changes");
  assert.equal(changesTabLabel(status([])), "Changes");
  assert.equal(changesTabLabel(status(["ordinary", "renamed", "conflict", "ignored"])), "Changes 3");
  assert.equal(changesTabLabel(status(["ordinary", "untracked", "untracked"])), "Changes 1 · 2 new");
  assert.equal(changesTabLabel(status(["untracked", "ignored"])), "Changes 1 new");
});

test("conflicts become a worded warning, only when there are some", () => {
  assert.equal(conflictWarning(status(["ordinary"])), null);
  assert.equal(conflictWarning(null), null);
  assert.equal(conflictWarning(status(["conflict"])), "! 1 conflict");
  assert.equal(conflictWarning(status(["conflict", "conflict", "ordinary"])), "! 2 conflicts");
});

test("an agent carries since when its tab last changed state", () => {
  const agents = [
    { pane: "p1", tab: "t1", status: "working" as const, program: { name: "Claude Code", key: "claude" } },
    { pane: "p2", tab: "t2", status: "idle" as const, program: { name: "Codex", key: "codex" } },
  ];
  const panes = [{ pane: "p1", cwd: "/w/app" }, { pane: "p2", cwd: "/w/app" }];
  const changed = new Map([["t1", 1_000]]);
  assert.deepEqual(repoAgents("/w/app", agents, panes, changed).map((a) => a.since), [1_000, null]);
  assert.deepEqual(repoAgents("/w/app", agents, panes).map((a) => a.since), [null, null]);
  assert.deepEqual(agentChips(repoAgents("/w/app", agents, panes, changed)).map((c) => c.since), [1_000, null]);
});
