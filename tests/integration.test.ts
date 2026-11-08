// Real git and find on a throwaway folder: proves the arguments and parsers
// against the actual programs, not just against strings we wrote ourselves.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { parseStatus, summarize, STATUS_ARGS } from "../src/core/git/status.ts";
import { findArgs, parseFound, findHerdRoot } from "../src/core/repos/discover.ts";
import { loadStatus } from "../src/core/scan.ts";

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

// A repo out of a downloaded archive: its own .git/config names a clean filter
// that leaves a marker file, and .gitattributes routes a tracked, changed file
// through it. Same size, new content: git must re-read the file, so plain
// `git status` would run the filter.
const exists = (path: string) => access(path).then(() => true, () => false);

async function trap(path: string, marker: string, how: "direct" | "include"): Promise<void> {
  await mkdir(path, { recursive: true });
  const at = { cwd: path, on: null };
  await git(at, ["init", "-q", "-b", "main"]);
  await writeFile(join(path, ".gitattributes"), "bait.txt filter=evil\n");
  await writeFile(join(path, "bait.txt"), "hi\n");
  await git(at, ["add", "."]);
  await git(at, ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);
  if (how === "direct") await git(at, ["config", "filter.evil.clean", `touch ${marker}`]);
  else {
    // Hidden one step away: `git config --local` alone doesn't follow includes.
    await writeFile(join(path, ".git", "extra.cfg"), `[filter "evil"]\n\tclean = touch ${marker}\n`);
    await git(at, ["config", "include.path", "extra.cfg"]);
  }
  await writeFile(join(path, "bait.txt"), "ho\n");
}

for (const how of ["direct", "include"] as const) {
  test(`a repo whose own config names a filter (${how}) is never given to git status`, async () => {
    const path = join(herd, `trap-${how}`);
    const marker = join(herd, `pwned-${how}`);
    await trap(path, marker, how);
    try {
      const r = await loadStatus(git, { cwd: path, on: null });
      assert.deepEqual(r, { status: null, error: null, untrusted: ["filter.evil.clean"] });
      assert.equal(await exists(marker), false, "the filter ran");
      // The trap is real: plain status does run it.
      await git({ cwd: path, on: null }, ["status", "--porcelain=v2"]);
      assert.equal(await exists(marker), true, "the trap didn't fire; the test proves nothing");
    } finally {
      await rm(path, { recursive: true, force: true });
      await rm(marker, { force: true });
    }
  });
}

test("status never enters a submodule, so a trap inside one stays shut", async () => {
  const outer = join(herd, "with-sub");
  const inner = join(herd, "sub-src");
  const marker = join(herd, "pwned-sub");
  // The submodule's source routes bait.txt through "evil"; only the checked-out copy defines it.
  await repo(inner);
  await writeFile(join(inner, ".gitattributes"), "bait.txt filter=evil\n");
  await writeFile(join(inner, "bait.txt"), "hi\n");
  await git({ cwd: inner, on: null }, ["add", "."]);
  await git({ cwd: inner, on: null }, ["commit", "-q", "-m", "bait"]);
  await repo(outer);
  const at = { cwd: outer, on: null };
  try {
    await git(at, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", inner, "sub"]);
    await git(at, ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "sub"]);
    const sub = join(outer, "sub");
    await git({ cwd: sub, on: null }, ["config", "filter.evil.clean", `touch ${marker}`]);
    await writeFile(join(sub, "bait.txt"), "ho\n");
    const r = await loadStatus(git, at);
    assert.ok(r.status, r.error ?? "no status");
    assert.equal(r.untrusted, undefined);
    assert.equal(await exists(marker), false, "the submodule's filter ran");
    // The trap is real: status that recurses into the submodule runs it.
    await git(at, ["status", "--porcelain=v2"]);
    assert.equal(await exists(marker), true, "the trap didn't fire; the test proves nothing");
  } finally {
    await rm(outer, { recursive: true, force: true });
    await rm(inner, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});
