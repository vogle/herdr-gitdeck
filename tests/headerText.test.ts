import { test } from "node:test";
import assert from "node:assert/strict";
import { behindNote, changesTabLabel, conflictWarning, uncommittedNote, FAR_BEHIND } from "../src/core/headerText.ts";
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

test("the Review tab says when work isn't committed yet, since it shows commits only", () => {
  assert.equal(uncommittedNote(null), null);
  assert.equal(uncommittedNote(status(["ignored"])), null);
  assert.equal(uncommittedNote(status(["ordinary"])), "1 file not committed yet: not in this review");
  assert.equal(uncommittedNote(status(["ordinary", "untracked", "conflict", "ignored"])), "3 files not committed yet: not in this review");
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

test("a sub-repo also shows the agent working in the repo around it, not one in a sibling or outside the herd", () => {
  const agents = [
    { pane: "root", status: "idle" as const, program: { name: "Claude Code", key: "claude" } },
    { pane: "sib", status: "working" as const, program: { name: "Codex", key: "codex" } },
    { pane: "home", status: "working" as const, program: { name: "Pi", key: "pi" } },
  ];
  const panes = [{ pane: "root", cwd: "/w/bsp" }, { pane: "sib", cwd: "/w/bsp/other" }, { pane: "home", cwd: "/w" }];
  const herd = ["/w/bsp", "/w/bsp/display", "/w/bsp/other"];
  assert.deepEqual(repoAgents("/w/bsp/display", agents, panes, new Map(), herd).map((a) => a.name), ["Claude Code"]);
  assert.deepEqual(repoAgents("/w/bsp/display", agents, panes).map((a) => a.name), [], "without the herd, only agents inside it");
});

test("far behind its base (20+ commits), the branch is told to catch up before it lands", () => {
  assert.equal(FAR_BEHIND, 20);
  assert.equal(behindNote({ base: "origin/main", ahead: 3, behind: 19 }), null);
  assert.equal(
    behindNote({ base: "origin/main", ahead: 3, behind: 20 }),
    "main has 20 commits this branch doesn't: merge or rebase before it lands, or it may conflict",
  );
  assert.equal(behindNote({ base: "stg", ahead: 0, behind: 41 })?.startsWith("stg has 41 commits"), true);
  assert.equal(behindNote(null), null);
});
