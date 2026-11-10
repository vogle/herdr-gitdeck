// Real git: M3 commands on a repo with a local "remote", none waiting for input.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import {
  NET_ENV, checkoutArgs, cherryPickArgs, createBranchArgs, fetchArgs, mergeArgs, pullArgs, pushArgs, readOperation, rebaseArgs,
  resetArgs, sequenceArgs, stashArgs, stashPushArgs,
} from "../src/core/ops.ts";

// A commit hook runs with GIT_INDEX_FILE and friends set; the test repos must not inherit them.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", timeout: 20_000, env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
const net = createGit(exec, NET_ENV);
const read = (p: string) => readFile(p, "utf8").catch(() => null);

let root = "";
let at = { cwd: "", on: null as string | null };
let other = { cwd: "", on: null as string | null };
const head = async (t = at) => (await git(t, ["rev-parse", "HEAD"])).trim();
const commit = async (file: string, text: string, msg: string, t = at) => {
  await writeFile(join(t.cwd, file), text);
  await git(t, ["add", file]);
  await git(t, ["commit", "-q", "-m", msg]);
};

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "gitdeck-ops-")));
  await git({ cwd: root, on: null }, ["init", "-q", "--bare", "-b", "main", "remote.git"]);
  for (const name of ["a", "b"]) {
    await mkdir(join(root, name));
    const t = { cwd: join(root, name), on: null };
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"], ["remote", "add", "origin", join(root, "remote.git")]]) await git(t, args);
  }
  at = { cwd: join(root, "a"), on: null };
  other = { cwd: join(root, "b"), on: null };
  await commit("f.txt", "base\n", "base");
});

after(() => rm(root, { recursive: true, force: true }));

test("a conflicting merge stops as a merge under way, and aborts back", async () => {
  const base = await head();
  await git(at, createBranchArgs("side", base, true));
  await commit("f.txt", "side\n", "side");
  await git(at, checkoutArgs({ kind: "branch", name: "main" }));
  await commit("f.txt", "main\n", "main");
  await assert.rejects(git(at, mergeArgs("side")));
  assert.equal(await readOperation(git, at, read), "merge");
  await git(at, sequenceArgs("merge", "abort"));
  assert.equal(await readOperation(git, at, read), null);
});

test("a conflicting rebase stops as a rebase, and aborts back", async () => {
  await git(at, checkoutArgs({ kind: "branch", name: "side" }));
  await assert.rejects(git(at, rebaseArgs("main")));
  assert.equal(await readOperation(git, at, read), "rebase");
  await git(at, sequenceArgs("rebase", "abort"));
  assert.equal(await readOperation(git, at, read), null);
  await git(at, checkoutArgs({ kind: "branch", name: "main" }));
});

test("cherry-pick and reset", async () => {
  await git(at, createBranchArgs("pick", await head(), true));
  await commit("g.txt", "g\n", "add g");
  const g = await head();
  await git(at, checkoutArgs({ kind: "branch", name: "main" }));
  const before = await head();
  await git(at, cherryPickArgs(g, 1));
  assert.equal(await read(join(at.cwd, "g.txt")), "g\n");
  await git(at, resetArgs(before, "hard"));
  assert.equal(await head(), before);
  assert.equal(await read(join(at.cwd, "g.txt")), null);
});

test("stash push with untracked files, then pop", async () => {
  await writeFile(join(at.cwd, "new.txt"), "n\n");
  await git(at, stashPushArgs("wip", true));
  assert.equal(await read(join(at.cwd, "new.txt")), null);
  await git(at, stashArgs("pop", "stash@{0}"));
  assert.equal(await read(join(at.cwd, "new.txt")), "n\n");
  await rm(join(at.cwd, "new.txt"));
});

test("push sets the upstream, the other clone fetches and pulls it", async () => {
  const args = pushArgs("main", null, ["origin"]);
  assert.ok(args);
  await net(at, args);
  await net(other, fetchArgs());
  await git(other, checkoutArgs({ kind: "remote", name: "origin/main" })).catch(async () => {
    // `b` already has an unborn main: point it at the fetched one instead.
    await git(other, ["reset", "-q", "--hard", "origin/main"]);
    await git(other, ["branch", "-u", "origin/main"]);
  });
  await commit("h.txt", "h\n", "add h");
  await net(at, ["push"]);
  await net(other, pullArgs());
  assert.equal(await head(other), await head());
});

test("a remote that needs a password fails at once instead of waiting", async () => {
  const started = Date.now();
  await assert.rejects(net(at, ["ls-remote", "https://example.invalid/x.git"]));
  assert.ok(Date.now() - started < 15_000);
});
