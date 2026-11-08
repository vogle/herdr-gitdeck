// Real git: blame, a renamed file's history, the reflog and taking a side.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { loadBlame, loadFileLog, loadReflog, takeSideArgs } from "../src/core/inspect.ts";

// A git hook running these tests sets GIT_AUTHOR_NAME and the like: drop them.
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
const commit = async (msg: string) => git(at, ["commit", "-q", "-m", msg]);
const head = async () => (await git(at, ["rev-parse", "HEAD"])).trim();

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "githerd-inspect-"))), on: null };
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "Tess"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  await writeFile(join(at.cwd, "a.txt"), "one\ntwo\n");
  await git(at, ["add", "a.txt"]);
  await commit("first");
  await writeFile(join(at.cwd, "a.txt"), "one\nTWO\n");
  await git(at, ["commit", "-q", "-am", "second"]);
  await git(at, ["mv", "a.txt", "b.txt"]);
  await commit("rename");
});

after(() => rm(at.cwd, { recursive: true, force: true }));

test("blame names the commit of each line", async () => {
  const b = await loadBlame(git, at, await head(), "b.txt");
  assert.equal(b.error, null);
  assert.deepEqual(b.items.map((l) => [l.text, l.summary, l.author]), [["one", "first", "Tess"], ["TWO", "second", "Tess"]]);
});

test("a file's history follows its rename", async () => {
  const log = await loadFileLog(git, at, await head(), "b.txt");
  assert.deepEqual(log.items.map((c) => c.subject), ["rename", "second", "first"]);
  assert.match((await loadBlame(git, at, await head(), "missing.txt")).error ?? "", /./);
});

test("the reflog lists HEAD's moves, newest first", async () => {
  const r = await loadReflog(git, at);
  assert.deepEqual(r.items.map((e) => e.action), ["commit: rename", "commit: second", "commit (initial): first"]);
});

test("a conflict resolved by taking theirs", async () => {
  await git(at, ["switch", "-q", "-c", "side"]);
  await writeFile(join(at.cwd, "b.txt"), "side\n");
  await git(at, ["commit", "-q", "-am", "side"]);
  await git(at, ["switch", "-q", "main"]);
  await writeFile(join(at.cwd, "b.txt"), "main\n");
  await git(at, ["commit", "-q", "-am", "main"]);
  await assert.rejects(git(at, ["merge", "--no-edit", "side"]));
  await git(at, takeSideArgs("theirs", ["b.txt"]));
  assert.equal(await readFile(join(at.cwd, "b.txt"), "utf8"), "side\n");
  await git(at, ["merge", "--abort"]);
});
