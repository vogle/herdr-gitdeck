import { test } from "node:test";
import assert from "node:assert/strict";
import type { RepoStatus, StatusEntry } from "../src/core/git/status.ts";
import type { Commit } from "../src/core/git/log.ts";
import { freshPaths, markSeen, newCommits, touch } from "../src/core/seen.ts";

const R = "/w/repo";
const e = (path: string, index = ".", worktree = "M", kind: StatusEntry["kind"] = "changed"): StatusEntry => ({ kind, index, worktree, path, origPath: null });
const status = (entries: StatusEntry[], oid: string | null = "h1"): RepoStatus => ({
  oid, branch: "main", upstream: null, ahead: 0, behind: 0, stash: 0, entries,
});
const c = (hash: string, parent: string | null): Commit => ({ hash, parents: parent ? [parent] : [], author: "a", email: "a@x", time: 0, subject: hash });

test("right after marking, nothing is new", () => {
  const s = status([e("a.ts"), e("b.ts", "M", ".")]);
  assert.deepEqual([...freshPaths(markSeen(R, s), s)], []);
});

test("a file that changed state, or appeared, since the mark is new", () => {
  const seen = markSeen(R, status([e("a.ts"), e("b.ts")]));
  const now = status([e("a.ts", "M", "."), e("b.ts"), e("c.ts", ".", ".", "untracked")]);
  assert.deepEqual([...freshPaths(seen, now)].sort(), ["a.ts", "c.ts"]);
});

test("a file written again since the mark is new even when its status looks the same", () => {
  const s = status([e("a.ts"), e("src/b.ts")]);
  const seen = touch(markSeen(R, s), R, [`${R}/src/b.ts`, `${R}/.git/index`, `${R}/node_modules/x.js`, "/elsewhere/a.ts"]);
  assert.deepEqual([...freshPaths(seen, s)], ["src/b.ts"]);
});

test("touch returns the same mark when nothing in the work tree changed", () => {
  const seen = markSeen(R, status([]));
  assert.equal(touch(seen, R, [`${R}/.git/HEAD`]), seen);
  assert.equal(touch(touch(seen, R, [`${R}/a`]), R, [`${R}/a`]).touched.size, 1);
});

test("a touched file that is clean again is not listed", () => {
  const seen = touch(markSeen(R, status([e("a.ts")])), R, [`${R}/a.ts`]);
  assert.deepEqual([...freshPaths(seen, status([]))], []);
});

test("newCommits counts the commits on top of the marked HEAD", () => {
  const log = [c("h3", "h2"), c("h2", "h1"), c("h1", "h0"), c("h0", null)];
  const seen = markSeen(R, status([], "h1"));
  assert.equal(newCommits(seen, "h3", log), 2);
  assert.equal(newCommits(seen, "h1", log), 0);
  assert.equal(newCommits(seen, "zz", log), null, "HEAD moved elsewhere (reset, switch): no count");
  assert.equal(newCommits(markSeen(R, status([], null)), "h3", log), 4, "from an empty repo every commit is new");
});
