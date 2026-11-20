// Real git: squashing later commits, run from gitdeck's own todo list.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { loadPlan, runPlan, squashBase, squashPlan } from "../src/core/rebase.ts";

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
const files = {
  read: (p: string) => readFile(p, "utf8").catch(() => null),
  write: (p: string, text: string, expected: string | null) => writeFile(p, text, { flag: expected === null ? "wx" : "w" }),
  remove: (p: string) => rm(p, { force: true }),
};
let at = { cwd: "", on: null as string | null };
const subjects = async () => (await git(at, ["log", "--format=%s"])).trim().split("\n");

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "gitdeck-rebase-"))), on: null };
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  for (const n of ["base", "one", "two", "three"]) {
    await writeFile(join(at.cwd, `${n}.txt`), `${n}\n`);
    await git(at, ["add", `${n}.txt`]);
    await git(at, ["commit", "-q", "-m", n]);
  }
});

after(() => rm(at.cwd, { recursive: true, force: true }));

test("squashing B keeps A and one commit B' with B's message and D's files", async () => {
  const b = (await git(at, ["rev-parse", "HEAD~2"])).trim();
  const tree = (await git(at, ["rev-parse", "HEAD^{tree}"])).trim();
  const loaded = await loadPlan(git, at, squashBase(b, 1));
  assert.ok(loaded.plan);
  assert.deepEqual(loaded.plan.steps.map((s) => s.subject), ["one", "two", "three"]);
  assert.equal(await runPlan(git, files, at, squashPlan(loaded.plan)), null);
  assert.deepEqual(await subjects(), ["one", "base"]);
  assert.equal((await git(at, ["log", "-1", "--format=%B"])).trim(), "one");
  assert.equal((await git(at, ["rev-parse", "HEAD^{tree}"])).trim(), tree, "the files are D's");
  const gitDir = (await git(at, ["rev-parse", "--absolute-git-dir"])).trim();
  assert.deepEqual((await readdir(gitDir)).filter((n) => n.startsWith("gitdeck")), [], "todo file removed");
});

test("a remote repo is refused before anything runs", async () => {
  assert.match((await runPlan(git, files, { cwd: "/x", on: "box" }, { base: null, steps: [] })) ?? "", /this machine/);
});
