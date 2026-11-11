import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutArgs, createBranchArgs, deleteBranchArgs, mergeArgs, rebaseArgs, cherryPickArgs, revertArgs, resetArgs, tagArgs,
  stashPushArgs, stashArgs, sequenceArgs, fetchArgs, pullArgs, pushArgs, refNameProblem, readOperation, NET_ENV, runOp, readRemotes,
} from "../src/core/ops.ts";
import { GitError, type Git } from "../src/core/git/runner.ts";

const H = "a".repeat(40);
const NO_EDITOR = ["-c", "core.editor=true"];

test("switching: a branch, a remote branch (tracked), or a commit (detached)", () => {
  assert.deepEqual(checkoutArgs({ kind: "branch", name: "dev" }), ["switch", "dev"]);
  assert.deepEqual(checkoutArgs({ kind: "remote", name: "origin/feat/x" }), ["switch", "--track", "origin/feat/x"]);
  assert.deepEqual(checkoutArgs({ kind: "commit", name: H }), ["switch", "--detach", H]);
});

test("branches and tags", () => {
  assert.deepEqual(createBranchArgs("feat/y", H, true), ["switch", "-c", "feat/y", H]);
  assert.deepEqual(createBranchArgs("feat/y", H, false), ["branch", "feat/y", H]);
  assert.deepEqual(deleteBranchArgs("old", false), ["branch", "-d", "old"]);
  assert.deepEqual(deleteBranchArgs("old", true), ["branch", "-D", "old"]);
  assert.deepEqual(tagArgs("v1.0", H), ["tag", "v1.0", H]);
});

test("refNameProblem rejects names git would refuse or read as options", () => {
  for (const ok of ["main", "feat/a-b", "v1.0", "x_y"]) assert.equal(refNameProblem(ok), null, ok);
  for (const bad of ["", "-x", "a b", "a..b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "x/", "/x", "x.lock", "x.", "@", "a@{b", "a//b", ".x", "a/.b"]) {
    assert.notEqual(refNameProblem(bad), null, bad);
  }
});

test("history-changing commands never wait for an editor", () => {
  assert.deepEqual(mergeArgs("dev"), ["merge", "--no-edit", "dev"]);
  assert.deepEqual(rebaseArgs("main"), [...NO_EDITOR, "rebase", "main"]);
  assert.deepEqual(cherryPickArgs(H, 1), ["cherry-pick", H]);
  assert.deepEqual(cherryPickArgs(H, 2), ["cherry-pick", "-m", "1", H]);
  assert.deepEqual(revertArgs(H, 1), ["revert", "--no-edit", H]);
  assert.deepEqual(revertArgs(H, 2), ["revert", "--no-edit", "-m", "1", H]);
  assert.deepEqual(resetArgs(H, "hard"), ["reset", "--hard", H]);
  assert.deepEqual(sequenceArgs("rebase", "continue"), [...NO_EDITOR, "rebase", "--continue"]);
  assert.deepEqual(sequenceArgs("merge", "abort"), [...NO_EDITOR, "merge", "--abort"]);
  assert.deepEqual(sequenceArgs("cherry-pick", "skip"), [...NO_EDITOR, "cherry-pick", "--skip"]);
});

test("stash", () => {
  const S = ["--no-literal-pathspecs", "stash"];
  assert.deepEqual(stashPushArgs("", true), [...S, "push", "--include-untracked"]);
  assert.deepEqual(stashPushArgs(" wip ", false), [...S, "push", "-m", "wip"]);
  assert.deepEqual(stashArgs("pop", "stash@{1}"), [...S, "pop", "stash@{1}"]);
  assert.deepEqual(stashArgs("drop", "stash@{0}"), [...S, "drop", "stash@{0}"]);
});

test("network: no prompts, and a first push sets the upstream", () => {
  assert.deepEqual(NET_ENV, ["GIT_TERMINAL_PROMPT=0"]);
  assert.deepEqual(fetchArgs(), ["fetch", "--all", "--prune"]);
  assert.deepEqual(pullArgs(), [...NO_EDITOR, "pull", "--no-edit"]);
  assert.deepEqual(pushArgs("main", "origin/main", ["origin"]), ["push"]);
  assert.deepEqual(pushArgs("feat", null, ["up", "origin"]), ["push", "-u", "origin", "feat"]);
  assert.deepEqual(pushArgs("feat", null, ["up"]), ["push", "-u", "up", "feat"]);
  assert.equal(pushArgs("feat", null, []), null);
  assert.equal(pushArgs(null, null, ["origin"]), null, "detached HEAD");
});

test("readOperation finds the merge, rebase, cherry-pick or revert under way", async () => {
  const gitWith = (present: string): Git => async (_t, args) => {
    if (args.at(-1) === present) return `${H}\n`;
    throw new GitError("no", args, 1, "");
  };
  const none = async () => null;
  // On another machine the markers are asked of git; a local repo reads them (below).
  const at = { cwd: "/r", on: "box" };
  assert.equal(await readOperation(gitWith("MERGE_HEAD"), at, none), "merge");
  assert.equal(await readOperation(gitWith("CHERRY_PICK_HEAD"), at, none), "cherry-pick");
  assert.equal(await readOperation(gitWith("REVERT_HEAD"), at, none), "revert");
  assert.equal(await readOperation(gitWith("REBASE_HEAD"), at, none), "rebase");
  assert.equal(await readOperation(gitWith("nothing"), at, none), null);
  // A rebase stopped to edit has no REBASE_HEAD but its rebase-merge folder.
  const gitDir: Git = async (_t, args) => {
    if (args.includes("--absolute-git-dir")) return "/r/.git\n";
    throw new GitError("no", args, 1, "");
  };
  assert.equal(await readOperation(gitDir, at, async (p) => (p === "/r/.git/rebase-merge/head-name" ? "refs/heads/x\n" : null)), "rebase");
});

test("a local repo's operation is read from its git dir: one git call, not five", async () => {
  const calls: string[][] = [];
  const gitDir: Git = async (_t, args) => {
    calls.push(args);
    if (args.includes("--absolute-git-dir")) return "/r/.git\n";
    throw new GitError("no", args, 1, "");
  };
  const local = { cwd: "/r", on: null };
  const only = (file: string) => async (p: string) => (p === `/r/.git/${file}` ? "x\n" : null);
  assert.equal(await readOperation(gitDir, local, only("MERGE_HEAD")), "merge");
  assert.equal(await readOperation(gitDir, local, only("CHERRY_PICK_HEAD")), "cherry-pick");
  assert.equal(await readOperation(gitDir, local, only("REVERT_HEAD")), "revert");
  assert.equal(await readOperation(gitDir, local, only("REBASE_HEAD")), "rebase");
  assert.equal(await readOperation(gitDir, local, only("rebase-apply/head-name")), "rebase");
  assert.equal(await readOperation(gitDir, local, async () => null), null);
  assert.equal(calls.length, 6, "one rev-parse per read");
  const broken: Git = async (_t, args) => {
    throw new GitError("no", args, 128, "");
  };
  assert.equal(await readOperation(broken, local, only("MERGE_HEAD")), null);
});

test("runOp reports a conflict from stdout, else git's own message", async () => {
  const at = { cwd: "/r", on: null };
  assert.equal(await runOp(async () => "", at, ["merge", "x"]), null);
  const conflict: Git = async (_t, a) => {
    throw new GitError("git merge exited 1", a, 1, "", "Auto-merging f\nCONFLICT (content): Merge conflict in f\n");
  };
  assert.match((await runOp(conflict, at, ["merge"])) ?? "", /^CONFLICT \(content\): Merge conflict in f/);
  const plain: Git = async (_t, a) => {
    throw new GitError("not a branch", a, 128, "fatal: not a branch");
  };
  assert.equal(await runOp(plain, at, ["switch"]), "not a branch");
  assert.equal(await runOp(async () => { throw new Error("gone"); }, at, []), "gone");
});

test("readRemotes lists the names, or none on error", async () => {
  const at = { cwd: "/r", on: null };
  assert.deepEqual(await readRemotes(async () => "origin\nup\n", at), ["origin", "up"]);
  assert.deepEqual(await readRemotes(async (_t, a) => { throw new GitError("x", a, 1, ""); }, at), []);
});
