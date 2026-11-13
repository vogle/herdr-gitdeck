import { test } from "node:test";
import assert from "node:assert/strict";
import { takeSide, splitChanges, stageFiles, unstageFiles, discardFiles, commitChanges, readLastMessage, loadStageDiff, applyPicks } from "../src/core/staging.ts";
import { GitError, type Git, type Target } from "../src/core/git/runner.ts";
import type { StatusEntry } from "../src/core/git/status.ts";

const at: Target = { cwd: "/r", on: null };
const e = (kind: StatusEntry["kind"], index: string, worktree: string, path: string): StatusEntry => ({ kind, index, worktree, path, origPath: null });

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

test("splitChanges puts each file in staged, unstaged, or both; conflicts on their own", () => {
  const s = splitChanges([
    e("changed", "M", ".", "a"),
    e("changed", ".", "M", "b"),
    e("changed", "M", "M", "c"),
    e("untracked", "?", "?", "n"),
    e("conflict", "U", "U", "x"),
    e("ignored", "!", "!", "i"),
  ]);
  assert.deepEqual(s.staged.map((f) => [f.path, f.letter]), [["a", "M"], ["c", "M"]]);
  assert.deepEqual(s.unstaged.map((f) => [f.path, f.letter, f.untracked]), [["b", "M", false], ["c", "M", false], ["n", "?", true]]);
  assert.deepEqual(s.conflicts.map((f) => f.path), ["x"]);
});

test("stage, unstage and commit run one git call and report errors as text", async () => {
  const r = recorder({ "commit -q -m x": new GitError("nothing to commit", ["commit"], 1, "nothing to commit") });
  assert.equal(await stageFiles(r.git, at, ["a", "b"]), null);
  assert.equal(await unstageFiles(r.git, at, ["a"], false), null);
  assert.equal(await commitChanges(r.git, at, "x", false), "nothing to commit");
  assert.equal(await commitChanges(r.git, at, "  \n", false), "Write a commit message first");
  assert.deepEqual(r.calls, [["add", "--", "a", "b"], ["rm", "--cached", "-q", "--", "a"], ["commit", "-q", "-m", "x"]]);
  assert.equal(await stageFiles(r.git, at, []), null);
  assert.equal(r.calls.length, 3, "nothing to stage: no call");
});

test("discardFiles restores tracked files and deletes untracked ones", async () => {
  const r = recorder();
  assert.equal(await discardFiles(r.git, at, [{ path: "a", untracked: false }, { path: "n", untracked: true }]), null);
  assert.deepEqual(r.calls, [["restore", "--worktree", "--", "a"], ["clean", "-f", "-q", "--", "n"]]);
});

test("readLastMessage trims, and is empty with no commit", async () => {
  assert.equal(await readLastMessage(recorder({ "log -1 --no-show-signature --format=%B": "Fix\n\nbody\n\n" }).git, at), "Fix\n\nbody");
  assert.equal(await readLastMessage(recorder({ "log -1 --no-show-signature --format=%B": new GitError("no HEAD", [], 128, "no HEAD") }).git, at), "");
});

test("loadStageDiff reads the raw diff of one side and parses it", async () => {
  const raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n";
  const r = recorder({ "diff --no-ext-diff --no-textconv --no-color --cached -- f": raw });
  const d = await loadStageDiff(r.git, at, "f", true);
  assert.equal(d.raw, raw);
  assert.deepEqual(d.rows.map((x) => x.kind), ["hunk", "del", "add"]);
  const bad = await loadStageDiff(recorder({ "diff --no-ext-diff --no-textconv --no-color -- f": new GitError("boom", [], 1, "boom") }).git, at, "f", false);
  assert.equal(bad.raw, "");
  assert.equal(bad.rows[0]?.text, "Can't show this diff: boom");
});

test("applyPicks writes the patch into the git folder and applies it to the index", async () => {
  const raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n";
  const r = recorder({ "rev-parse --absolute-git-dir": "/r/.git\n" });
  const writes: Array<[string, string]> = [];
  const removed: string[] = [];
  const files = {
    read: async (_p: string) => null,
    write: async (p: string, text: string, expected: string | null) => {
      assert.equal(expected, null, "a new file only");
      writes.push([p, text]);
    },
    remove: async (p: string) => {
      removed.push(p);
    },
  };
  assert.equal(await applyPicks(r.git, files, at, raw, [{ hunk: 0, lines: null }], false), null);
  const [path = "", text] = writes[0] ?? [];
  assert.match(path, /^\/r\/\.git\/gitdeck-[a-z0-9]+-[a-z0-9]+\.patch$/);
  assert.equal(text, raw.replace("@@ -1 +1 @@", "@@ -1,1 +1,1 @@"));
  assert.deepEqual(r.calls.at(-1), ["apply", "--cached", "--recount", "--whitespace=nowarn", path]);
  assert.deepEqual(removed, [path], "removed after use");
});

test("applyPicks refuses a remote repo, an empty pick, and reports apply errors", async () => {
  const raw = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n";
  const files = { read: async () => null, write: async () => undefined, remove: async () => undefined };
  assert.match((await applyPicks(recorder().git, files, { cwd: "/r", on: "box" }, raw, [{ hunk: 0, lines: null }], false)) ?? "", /this machine/);
  assert.equal(await applyPicks(recorder().git, files, at, raw, [{ hunk: 0, lines: new Set([5]) }], false), "Nothing picked to change");
  const failing: Git = async (_t, args) => {
    if (args[0] === "rev-parse") return "/r/.git";
    throw new GitError("patch does not apply", args, 1, "patch does not apply");
  };
  const removed: string[] = [];
  const tracked = { ...files, remove: async (p: string) => void removed.push(p) };
  assert.equal(await applyPicks(failing, tracked, at, raw, [{ hunk: 0, lines: null }], true), "patch does not apply");
  assert.equal(removed.length, 1, "removed even when apply fails");
});

test("takeSide checks out one side, then stages it; an error stops before staging", async () => {
  const at = { cwd: "/r", on: null };
  const calls: string[][] = [];
  const ok: Git = async (_t, args) => {
    calls.push(args);
    return "";
  };
  assert.equal(await takeSide(ok, at, ["f"], "theirs"), null);
  assert.deepEqual(calls.map((c) => c[0]), ["checkout", "add"]);
  assert.deepEqual(calls[0], ["checkout", "--theirs", "--", "f"]);
  const failing: Git = async (_t, args) => {
    throw new GitError("no theirs version", args, 1, "");
  };
  assert.equal(await takeSide(failing, at, ["f"], "ours"), "no theirs version");
  assert.equal(await takeSide(ok, at, [], "ours"), null);
});
