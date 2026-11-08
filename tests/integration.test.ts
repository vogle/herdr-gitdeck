// Real git and find on a throwaway folder: proves the arguments and parsers
// against the actual programs, not just against strings we wrote ourselves.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { parseStatus, summarize, STATUS_ARGS } from "../src/core/git/status.ts";
import { findArgs, parseFound, findHerdRoot } from "../src/core/repos/discover.ts";

// Herdr's exec, played by Node: an argument array, never a shell.
const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);

let herd = "";

async function repo(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const at = { cwd: path, on: null };
  await git(at, ["init", "-q", "-b", "main"]);
  await git(at, ["config", "user.email", "t@example.com"]);
  await git(at, ["config", "user.name", "t"]);
  await git(at, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(path, "README.md"), "hi\n");
  await git(at, ["add", "."]);
  await git(at, ["commit", "-q", "-m", "init"]);
}

before(async () => {
  herd = await realpath(await mkdtemp(join(tmpdir(), "githerd-")));
  await repo(herd);
  await repo(join(herd, "svc-a"));
  await repo(join(herd, "libs", "core"));
  await repo(join(herd, "node_modules", "skipped"));
  await repo(join(herd, ".hidden", "skipped"));
  await mkdir(join(herd, "svc-a", "src"), { recursive: true });
  // svc-a: one staged, one unstaged, one untracked file with a space in its name.
  await writeFile(join(herd, "svc-a", "staged.txt"), "s\n");
  await git({ cwd: join(herd, "svc-a"), on: null }, ["add", "staged.txt"]);
  await writeFile(join(herd, "svc-a", "README.md"), "changed\n");
  await writeFile(join(herd, "svc-a", "new file.txt"), "n\n");
});

after(async () => {
  await rm(herd, { recursive: true, force: true });
});

test("find with findArgs lists nested repos and skips node_modules and hidden folders", async () => {
  const r = await exec("find", findArgs(herd, 3), { cwd: herd });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    parseFound(herd, r.stdout).repos.map((x) => `${x.group}|${x.name}`),
    ["|svc-a", "libs|core"],
  );
});

test("a herd root whose own name is on the skip list (build) is still searched", async () => {
  const root = join(herd, "libs", "build");
  await repo(join(root, "inner"));
  try {
    const r = await exec("find", findArgs(root, 2), { cwd: root });
    assert.deepEqual(parseFound(root, r.stdout).repos.map((x) => x.name), ["inner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findHerdRoot from inside a nested repo climbs to the outer repo", async () => {
  const r = await findHerdRoot(git, { cwd: join(herd, "svc-a", "src"), on: null }, "/nonexistent-home");
  assert.deepEqual(r, { root: herd, focused: join(herd, "svc-a") });
});

test("real porcelain v2 output parses into the expected entries and summary", async () => {
  const out = await git({ cwd: join(herd, "svc-a"), on: null }, [...STATUS_ARGS]);
  const s = parseStatus(out);
  assert.equal(s.branch, "main");
  assert.match(s.oid ?? "", /^[0-9a-f]{40}$/);
  assert.deepEqual(summarize(s), { staged: 1, unstaged: 1, untracked: 1, conflicts: 0, clean: false });
  assert.ok(s.entries.some((e) => e.kind === "untracked" && e.path === "new file.txt"));
});

test("git outside a repo fails with a GitError, and findHerdRoot treats it as no repo", async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), "githerd-none-")));
  try {
    const r = await findHerdRoot(git, { cwd: outside, on: null }, "/nonexistent-home");
    assert.deepEqual(r, { root: outside, focused: null });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
