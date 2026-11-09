import { test } from "node:test";
import assert from "node:assert/strict";
import { GitError, type Git, type Target } from "../src/core/git/runner.ts";
import type { Files } from "../src/core/staging.ts";
import { excludeLocally, excludePattern, withExcluded } from "../src/core/exclude.ts";
import { agentNote, repoAgents } from "../src/core/repoAgents.ts";
import { undoLastCommit } from "../src/core/undo.ts";

const at: Target = { cwd: "/r", on: null };

function recorder(answers: Record<string, string | GitError> = {}): { git: Git; calls: string[][] } {
  const calls: string[][] = [];
  const git: Git = async (_t, args) => {
    calls.push(args);
    const a = answers[args.join(" ")];
    if (a instanceof GitError) throw a;
    return a ?? "";
  };
  return { git, calls };
}

function memoryFiles(start: Record<string, string>): Files & { store: Record<string, string> } {
  const store = { ...start };
  return {
    store,
    read: async (path) => store[path] ?? null,
    write: async (path, text, expected) => {
      if ((store[path] ?? null) !== expected) throw new Error("changed meanwhile");
      store[path] = text;
    },
    remove: async (path) => {
      delete store[path];
    },
  };
}

// --- Ignore locally (.git/info/exclude) ---

test("excludePattern anchors the path at the repo root and escapes pattern characters", () => {
  assert.equal(excludePattern(".claude/"), "/.claude/");
  assert.equal(excludePattern("notes.md"), "/notes.md");
  assert.equal(excludePattern("a[1]*?.txt"), "/a\\[1\\]\\*\\?.txt");
  assert.equal(excludePattern("back\\slash"), "/back\\\\slash");
  assert.equal(excludePattern("trail "), "/trail\\ ");
});

test("withExcluded appends one line, on a line of its own, or nothing when present", () => {
  assert.equal(withExcluded("", ".moai/"), "/.moai/\n");
  assert.equal(withExcluded("# git ls-files\n*.log\n", ".moai/"), "# git ls-files\n*.log\n/.moai/\n");
  assert.equal(withExcluded("*.log", ".moai/"), "*.log\n/.moai/\n");
  assert.equal(withExcluded("/.moai/\n", ".moai/"), null);
});

test("excludeLocally writes the repo's exclude file, wherever git keeps it", async () => {
  const r = recorder({ "rev-parse --git-path info/exclude": ".git/info/exclude\n" });
  const files = memoryFiles({ "/r/.git/info/exclude": "# keep\n" });
  assert.equal(await excludeLocally(r.git, files, at, ".claude/"), null);
  assert.equal(files.store["/r/.git/info/exclude"], "# keep\n/.claude/\n");
  // A linked worktree: git answers an absolute path into the main repo.
  const w = recorder({ "rev-parse --git-path info/exclude": "/main/.git/info/exclude\n" });
  const wf = memoryFiles({});
  assert.equal(await excludeLocally(w.git, wf, at, "x"), null);
  assert.equal(wf.store["/main/.git/info/exclude"], "/x\n");
  // Already listed: nothing written.
  assert.equal(await excludeLocally(r.git, files, at, ".claude/"), null);
});

test("excludeLocally refuses another machine's repo and reports errors as text", async () => {
  assert.equal(await excludeLocally(recorder().git, memoryFiles({}), { cwd: "/r", on: "m1" }, "x"), "Ignoring a file works only for repos on this machine");
  const r = recorder({ "rev-parse --git-path info/exclude": new GitError("not a git repository", [], 128, "") });
  assert.equal(await excludeLocally(r.git, memoryFiles({}), at, "x"), "not a git repository");
});

// --- Agents working in the shown repo ---

const agent = (pane: string, status: "working" | "blocked" | "done" | "idle", name = "Claude Code") =>
  ({ pane, status, tab_name: "1", program: { name } });

test("repoAgents keeps the agents whose pane is in the repo or below it", () => {
  const panes = [
    { pane: "p1", cwd: "/w/app" },
    { pane: "p2", cwd: "/w/app/src" },
    { pane: "p3", cwd: "/w/application" },
    { pane: "p4", cwd: null },
  ];
  const all = [agent("p1", "idle"), agent("p2", "working", "Codex"), agent("p3", "working"), agent("p4", "working"), agent("p9", "done")];
  assert.deepEqual(repoAgents("/w/app", all, panes).map((a) => [a.name, a.status]), [["Claude Code", "idle"], ["Codex", "working"]]);
  assert.deepEqual(repoAgents(null, all, panes), []);
});

test("agentNote says the most urgent state, and nothing for idle agents", () => {
  assert.equal(agentNote([]), null);
  assert.equal(agentNote([{ name: "Claude Code", status: "idle" }]), null);
  assert.deepEqual(agentNote([{ name: "Claude Code", status: "done" }]), { kind: "done", text: "Claude Code finished: review its changes before committing" });
  assert.deepEqual(agentNote([{ name: "Claude Code", status: "blocked" }]), { kind: "blocked", text: "Claude Code is waiting for you" });
  assert.deepEqual(
    agentNote([{ name: "Claude Code", status: "done" }, { name: "Codex", status: "working" }]),
    { kind: "working", text: "Codex is working here: its changes may not be finished" },
  );
  assert.deepEqual(
    agentNote([{ name: "Claude Code", status: "working" }, { name: "Codex", status: "working" }]),
    { kind: "working", text: "2 agents are working here: their changes may not be finished" },
  );
});

// --- Undo the last commit ---

test("undoLastCommit moves HEAD back one commit and keeps its changes staged", async () => {
  const r = recorder({ "rev-parse --verify -q HEAD~1": "abc\n", "for-each-ref --contains HEAD --format=%(refname) refs/remotes": "" });
  assert.equal(await undoLastCommit(r.git, at), null);
  assert.deepEqual(r.calls.at(-1), ["reset", "--soft", "HEAD~1"]);
});

test("undoLastCommit refuses a pushed commit and the first commit", async () => {
  const pushed = recorder({ "rev-parse --verify -q HEAD~1": "abc\n", "for-each-ref --contains HEAD --format=%(refname) refs/remotes": "refs/remotes/origin/main\n" });
  assert.equal(await undoLastCommit(pushed.git, at), "This commit is already on origin/main: undoing it would rewrite pushed history");
  assert.ok(!pushed.calls.some((c) => c[0] === "reset"));
  const first = recorder({ "rev-parse --verify -q HEAD~1": new GitError("", [], 1, "") });
  assert.equal(await undoLastCommit(first.git, at), "The first commit can't be undone here");
  const failing = recorder({
    "rev-parse --verify -q HEAD~1": "abc\n",
    "for-each-ref --contains HEAD --format=%(refname) refs/remotes": "",
    "reset --soft HEAD~1": new GitError("index.lock exists", [], 128, ""),
  });
  assert.equal(await undoLastCommit(failing.git, at), "index.lock exists");
});
