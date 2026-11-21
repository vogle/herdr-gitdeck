import { test } from "node:test";
import assert from "node:assert/strict";
import { commitWindow, parseWorktrees } from "../../src/core/agentLink/claudeLink.ts";
import type { Git } from "../../src/core/git/runner.ts";

test("parseWorktrees lists every worktree's folder", () => {
  assert.deepEqual(parseWorktrees("worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/one\nHEAD def\n"), ["/repo", "/wt/one"]);
});

test("commitWindow reads the parent's time, the worktrees and the branch", async () => {
  const git: Git = async (_t, args) => {
    if (args[0] === "worktree") return "worktree /repo\n\nworktree /wt\n";
    if (args[0] === "log") return "1700\n";
    return "main\n";
  };
  const w = await commitWindow(git, { cwd: "/repo", on: null }, { time: 1800, parents: ["p"], files: ["a.ts"] });
  assert.deepEqual(w, { time: 1800, parentTime: 1700, files: ["a.ts"], roots: ["/repo", "/wt"], branch: "main" });
});

test("commitWindow of a root commit on a detached HEAD, when git fails", async () => {
  const git: Git = async () => { throw new Error("no"); };
  const w = await commitWindow(git, { cwd: "/repo", on: null }, { time: 5, parents: [], files: [] });
  assert.deepEqual(w, { time: 5, parentTime: 0, files: [], roots: ["/repo"], branch: null });
});
