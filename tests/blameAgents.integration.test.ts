// Real git (AC-4): a Git AI note on a commit marks the lines it names in a later blame.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { loadBlame } from "../src/core/inspect.ts";
import { readNoteLines, withBlameAgents } from "../src/core/agentLink/gitAi.ts";

// GIT_CONFIG_GLOBAL keeps the user's ~/.gitconfig out of the test repo.
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null" };
const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
let at = { cwd: "", on: null as string | null };

const META = JSON.stringify({
  schema_version: "authorship/3.0.0",
  sessions: { s_1: { agent_id: { tool: "claude", id: "abc", model: "claude-opus-5-5" } } },
});

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "gitdeck-blame-agents-"))), on: null };
  for (const a of [["init", "-q", "--template=", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "Tess"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  await writeFile(join(at.cwd, "a.ts"), "1\n2\n3\n4\n5\n6\n");
  await git(at, ["add", "a.ts"]);
  await git(at, ["commit", "-q", "-m", "agent writes 3-5"]);
  await git(at, ["notes", "--ref=ai", "add", "-m", `a.ts\n  s_1::t_1 3-5\n---\n${META}`, "HEAD"]);
  // A person adds two lines on top: the agent's lines move to 5-7 in the new version.
  await writeFile(join(at.cwd, "a.ts"), "top\ntop\n1\n2\n3\n4\n5\n6\n");
  await git(at, ["commit", "-q", "-am", "person adds two lines"]);
});

after(() => rm(at.cwd, { recursive: true, force: true }));

test("only the lines the note names are marked, where they are now", async () => {
  const blame = await loadBlame(git, at, "HEAD", "a.ts");
  const notes = await readNoteLines(git, at, blame.items.map((l) => l.hash), new Map());
  const marked = withBlameAgents(blame.items, notes).filter((l) => l.agent !== undefined);
  assert.deepEqual(marked.map((l) => [l.line, l.agent]), [[5, "Claude Code"], [6, "Claude Code"], [7, "Claude Code"]]);
});
