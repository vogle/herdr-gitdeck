// Real git: staging a hunk or single lines through a patch file, and back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { applyPicks, commitChanges, loadStageDiff, stageFiles, unstageFiles } from "../src/core/staging.ts";

const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
const files = {
  read: (p: string) => readFile(p, "utf8").catch(() => null),
  write: (p: string, text: string) => writeFile(p, text),
};

let at = { cwd: "", on: null as string | null };
const lines = (n: number, f: (i: number) => string) => `${Array.from({ length: n }, (_, i) => f(i)).join("\n")}\n`;

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "githerd-stage-"))), on: null };
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  await writeFile(join(at.cwd, "f.txt"), lines(20, (i) => `line ${i}`));
  await stageFiles(git, at, ["f.txt"]);
  assert.equal(await commitChanges(git, at, "first", false), null);
  // Two hunks: line 1 changed, line 18 changed.
  await writeFile(join(at.cwd, "f.txt"), lines(20, (i) => (i === 1 ? "ONE" : i === 18 ? "EIGHTEEN" : `line ${i}`)));
});

after(() => rm(at.cwd, { recursive: true, force: true }));

const cached = () => git(at, ["diff", "--cached", "--no-color", "-U0"]);

test("one hunk stages alone, then unstages back", async () => {
  const d = await loadStageDiff(git, at, "f.txt", false);
  assert.equal(d.rows.filter((r) => r.kind === "hunk").length, 2);
  assert.equal(await applyPicks(git, files, at, d.raw, [{ hunk: 1, lines: null }], false), null);
  const staged = await cached();
  assert.match(staged, /\+EIGHTEEN/);
  assert.doesNotMatch(staged, /ONE/);
  const s = await loadStageDiff(git, at, "f.txt", true);
  assert.equal(await applyPicks(git, files, at, s.raw, [{ hunk: 0, lines: null }], true), null);
  assert.equal(await cached(), "");
});

test("a single removed line stages without its added partner", async () => {
  const d = await loadStageDiff(git, at, "f.txt", false);
  // Hunk 0's body: context..., "-line 1", "+ONE", context...: pick only the removal.
  const raw = d.raw.split("\n");
  const start = raw.findIndex((l) => l.startsWith("@@"));
  const body = raw.slice(start + 1);
  const del = body.findIndex((l) => l === "-line 1");
  assert.equal(await applyPicks(git, files, at, d.raw, [{ hunk: 0, lines: new Set([del]) }], false), null);
  const staged = await cached();
  assert.match(staged, /-line 1/);
  assert.doesNotMatch(staged, /\+ONE/);
  assert.equal(await unstageFiles(git, at, ["f.txt"], true), null);
  assert.equal(await cached(), "");
});
