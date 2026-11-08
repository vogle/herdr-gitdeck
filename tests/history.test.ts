import { test } from "node:test";
import assert from "node:assert/strict";
import { GitError, type Git } from "../src/core/git/runner.ts";
import { loadHistory, loadCommit, loadDiff, searchCommits, withUncommitted, UNCOMMITTED } from "../src/core/history.ts";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const T = { cwd: "/r", on: null };

const LOG = `${H1}\x1f${H2}\x1fAnn\x1fann@x.io\x1f1700000000\x1fAdd graph\x1e\n${H2}\x1f\x1fBo\x1fbo@x.io\x1f1690000000\x1fInitial commit\x1e\n`;
const REFS = `refs/heads/main\x1f${H1}\x1f\x1forigin/main\x1fahead 1\x1f*\nrefs/tags/v0\x1f${H2}\x1f\x1f\x1f\x1f `;
const STASH = `${H2}\x1fstash@{0}\x1fWIP on main\n`;

function fake(answers: Record<string, string | GitError>, calls: string[][] = []): Git {
  return async (_t, args) => {
    calls.push(args);
    const key = args[0] === "stash" ? "stash" : args[0] ?? "";
    const a = answers[key];
    if (a instanceof GitError) throw a;
    return a ?? "";
  };
}

test("loadHistory reads commits, refs and stashes and lays out lanes", async () => {
  const h = await loadHistory(fake({ log: LOG, "for-each-ref": REFS, stash: STASH }), T, 500);
  assert.equal(h.error, null);
  assert.deepEqual(h.commits.map((c) => c.subject), ["Add graph", "Initial commit"]);
  assert.deepEqual(h.lanes.rows.map((r) => r.lane), [0, 0]);
  assert.deepEqual(h.refs.map((r) => r.name), ["main", "v0"]);
  assert.deepEqual(h.byCommit[H1]?.map((r) => r.name), ["main"]);
  assert.deepEqual(h.stashes.map((s) => s.name), ["stash@{0}"]);
  assert.equal(h.limited, false);
});

test("loadHistory says when the log hit its limit", async () => {
  const h = await loadHistory(fake({ log: LOG, "for-each-ref": REFS }), T, 2);
  assert.equal(h.limited, true);
});

test("a repo with no commits yet is an empty history, not an error", async () => {
  const h = await loadHistory(fake({ log: new GitError("fatal: ambiguous argument 'HEAD'", [], 128, ""), "for-each-ref": "" }), T, 500);
  assert.equal(h.error, null);
  assert.deepEqual(h.commits, []);
});

test("a log failure with refs present is reported", async () => {
  const h = await loadHistory(fake({ log: new GitError("fatal: bad object", [], 128, ""), "for-each-ref": REFS }), T, 500);
  assert.equal(h.error, "fatal: bad object");
  assert.deepEqual(h.commits, []);
});

test("a failing stash list only loses the stashes", async () => {
  const h = await loadHistory(fake({ log: LOG, "for-each-ref": REFS, stash: new GitError("nope", [], 1, "") }), T, 500);
  assert.equal(h.error, null);
  assert.deepEqual(h.stashes, []);
});

test("loadCommit joins the header with the changed files", async () => {
  const calls: string[][] = [];
  const git: Git = async (_t, args) => {
    calls.push(args);
    if (args[0] === "show") return `${H1}\x1f${H2}\x1fAnn\x1fa@x\x1f1\x1fAnn\x1fa@x\x1f2\x1fAdd graph\n\nBody\n`;
    if (args.includes("--name-status")) return "M\0src/a.ts\0";
    return "4\t1\tsrc/a.ts\0";
  };
  const d = await loadCommit(git, T, H1, [H2]);
  assert.equal(d.error, null);
  assert.equal(d.detail?.message, "Add graph\n\nBody");
  assert.deepEqual(d.files, [{ status: "M", path: "src/a.ts", oldPath: null, added: 4, deleted: 1, binary: false }]);
  assert.ok(calls.every((a) => a[0] === "show" || (a.includes("--no-ext-diff") && a.includes("--no-textconv"))));
});

test("loadCommit reports a failure instead of throwing", async () => {
  const d = await loadCommit(fake({ show: new GitError("fatal: bad object", [], 128, "") }), T, H1, []);
  assert.equal(d.error, "fatal: bad object");
  assert.equal(d.detail, null);
});

test("loadDiff of a commit file, a work-tree file and an untracked file", async () => {
  const calls: string[][] = [];
  const patch = "@@ -1 +1 @@\n-a\n+b\n";
  const git: Git = async (_t, args) => {
    calls.push(args);
    if (args.includes("--no-index")) throw new GitError("", args, 1, "");
    return patch;
  };
  const c = await loadDiff(git, T, { kind: "commit", hash: H1, parents: [H2], path: "f", oldPath: null });
  assert.equal(c.rows.length, 3);
  assert.equal(calls[0]?.[0], "diff-tree");
  await loadDiff(git, T, { kind: "worktree", path: "f", hasHead: true });
  assert.deepEqual(calls[1]?.slice(-3), ["HEAD", "--", "f"]);
  // --no-index exits 1 when the file differs: that is still a diff, read from the error's stdout.
  const u = await loadDiff(async (_t, args) => { throw Object.assign(new GitError("", args, 1, ""), { stdout: patch }); }, T, { kind: "untracked", path: "n" });
  assert.equal(u.rows.length, 3);
});

test("loadDiff turns a failure into a note", async () => {
  const d = await loadDiff(fake({ "diff-tree": new GitError("fatal: boom", [], 128, "") }), T, { kind: "commit", hash: H1, parents: [], path: "f", oldPath: null });
  assert.deepEqual(d.rows, [{ kind: "note", old: null, new: null, text: "Can't show this diff: fatal: boom" }]);
});

test("searchCommits matches subject, author, hash prefix and ref names, ignoring case", async () => {
  const h = await loadHistory(fake({ log: LOG, "for-each-ref": REFS }), T, 500);
  const find = (q: string) => searchCommits(h.commits, h.byCommit, q).map((i) => h.commits[i]?.subject);
  assert.deepEqual(find("GRAPH"), ["Add graph"]);
  assert.deepEqual(find("bo"), ["Initial commit"]);
  assert.deepEqual(find("bbbbbbb"), ["Initial commit"]);
  assert.deepEqual(find("v0"), ["Initial commit"]);
  assert.deepEqual(find("origin"), []);
  assert.deepEqual(find("  "), [0, 1].map((i) => h.commits[i]?.subject));
});

test("withUncommitted puts a dashed row above HEAD when the tree has changes", () => {
  const commits = [{ hash: H1, parents: [H2], author: "", email: "", time: 0, subject: "x" }];
  assert.equal(withUncommitted(commits, H1, 0), commits);
  const rows = withUncommitted(commits, H1, 3);
  assert.equal(rows[0]?.hash, UNCOMMITTED);
  assert.deepEqual(rows[0]?.parents, [H1]);
  assert.equal(rows[0]?.subject, "Uncommitted changes (3)");
  assert.equal(rows.length, 2);
  assert.equal(withUncommitted([], null, 2)[0]?.parents.length, 0);
});
