import { test } from "node:test";
import assert from "node:assert/strict";
import { findArgs, parseFound, findHerdRoot, MAX_REPOS, SKIP_DIRS } from "../src/core/repos/discover.ts";
import { GitError, type Git } from "../src/core/git/runner.ts";

test("findArgs prints each .git (folder or file) and prunes hidden and heavy folders, depth counted below the root", () => {
  const args = findArgs("/w/herd/", 3);
  assert.equal(args[0], "/w/herd");
  // -mindepth 1: the root itself is never pruned, even when it's called `build` or `.dotfiles`.
  assert.deepEqual(args.slice(1, 5), ["-mindepth", "1", "-maxdepth", "4"]);
  const joined = args.join(" ");
  assert.match(joined, /-name \.git -print -prune/);
  for (const dir of SKIP_DIRS) assert.ok(args.includes(dir), dir);
  assert.match(joined, /-name \.\* \) -prune/);
  // .git must be tested before hidden folders are pruned, or it would never print.
  assert.ok(joined.indexOf("-name .git") < joined.indexOf("-name .*"));
});

test("findArgs clamps depth to 1..6", () => {
  assert.equal(findArgs("/r", 0)[4], "2");
  assert.equal(findArgs("/r", 99)[4], "7");
});

test("parseFound lists repos below the root, grouped by their parent folder, sorted, root excluded", () => {
  const out = [
    "/w/herd/.git",
    "/w/herd/svc-b/.git",
    "/w/herd/libs/core/.git",
    "/w/herd/svc-a/.git",
    "/w/herd/libs/api/.git",
    "",
  ].join("\n");
  assert.deepEqual(parseFound("/w/herd/", out), {
    truncated: false,
    repos: [
      { path: "/w/herd/svc-a", name: "svc-a", group: "" },
      { path: "/w/herd/svc-b", name: "svc-b", group: "" },
      { path: "/w/herd/libs/api", name: "api", group: "libs" },
      { path: "/w/herd/libs/core", name: "core", group: "libs" },
    ],
  });
});

test("parseFound ignores lines outside the root, stops at the max and says it did", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `/r/r${i}/.git`);
  const found = parseFound("/r", ["/elsewhere/x/.git", ...lines].join("\n"), 3);
  assert.equal(found.repos.length, 3);
  assert.equal(found.truncated, true);
  assert.equal(parseFound("/r", lines.slice(0, 3).join("\n"), 3).truncated, false);
  assert.ok(MAX_REPOS >= 100);
});

// A fake git: the toplevel of each folder, as `git rev-parse --show-toplevel` would answer.
const fakeGit = (toplevels: Record<string, string>): Git => async (target, args) => {
  assert.deepEqual(args, ["rev-parse", "--show-toplevel"]);
  const top = toplevels[target.cwd];
  if (!top) throw new GitError("fatal: not a git repository", args, 128, "");
  return `${top}\n`;
};

test("findHerdRoot climbs to the outermost enclosing repo and keeps the focused one", async () => {
  const git = fakeGit({
    "/w/herd/svc-a/src": "/w/herd/svc-a",
    "/w/herd": "/w/herd",
  });
  const r = await findHerdRoot(git, { cwd: "/w/herd/svc-a/src", on: null }, "/Users/me");
  assert.deepEqual(r, { root: "/w/herd", focused: "/w/herd/svc-a" });
});

test("findHerdRoot stops at the home folder", async () => {
  const git = fakeGit({ "/Users/me/proj": "/Users/me/proj", "/Users/me": "/Users/me" });
  const r = await findHerdRoot(git, { cwd: "/Users/me/proj", on: null }, "/Users/me");
  assert.deepEqual(r, { root: "/Users/me/proj", focused: "/Users/me/proj" });
});

test("findHerdRoot of a folder outside any repo has no focused repo and uses the folder as root", async () => {
  const r = await findHerdRoot(fakeGit({}), { cwd: "/w/many", on: null }, "/Users/me");
  assert.deepEqual(r, { root: "/w/many", focused: null });
});

test("empty rev-parse output (old git in a bare repo or inside .git) counts as no repo, never as /", async () => {
  const git: Git = async () => "\n";
  const r = await findHerdRoot(git, { cwd: "/w/x.git", on: null }, "/Users/me");
  assert.deepEqual(r, { root: "/w/x.git", focused: null });
});

test("findHerdRoot passes other failures on", async () => {
  const git: Git = async () => {
    throw new GitError("machine unreachable", [], -1, "");
  };
  await assert.rejects(() => findHerdRoot(git, { cwd: "/w", on: "far" }, "/h"), /unreachable/);
});
