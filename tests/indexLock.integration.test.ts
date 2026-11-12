// Real git: gitdeck's reads must leave .git/index alone. A diff that refreshes
// the index takes index.lock, and an agent's `git add`/`git commit` in the same
// repo then fails with "index.lock: File exists".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { STATUS_ARGS } from "../src/core/git/status.ts";
import { worktreeDiffArgs } from "../src/core/git/show.ts";
import { unstagedDiffArgs } from "../src/core/stage.ts";

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
let at = { cwd: "", on: null as string | null };

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "gitdeck-index-"))), on: null };
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  await writeFile(join(at.cwd, "f.txt"), "one\n");
  await git(at, ["add", "f.txt"]);
  await git(at, ["commit", "-q", "-m", "first"]);
});

after(() => rm(at.cwd, { recursive: true, force: true }));

/** Makes f.txt stat-dirty (same content, new mtime): the case a refresh would rewrite the index for. */
async function touch(): Promise<number> {
  const later = new Date(Date.now() + 5_000);
  await utimes(join(at.cwd, "f.txt"), later, later);
  return (await stat(join(at.cwd, ".git", "index"))).mtimeMs;
}

for (const [name, args] of [
  ["status", [...STATUS_ARGS]],
  ["diff against HEAD", worktreeDiffArgs("f.txt", true)],
  ["unstaged diff", unstagedDiffArgs("f.txt")],
] as const) {
  test(`${name} leaves .git/index untouched`, async () => {
    const before = await touch();
    await git(at, [...args]);
    assert.equal((await stat(join(at.cwd, ".git", "index"))).mtimeMs, before);
  });
}
