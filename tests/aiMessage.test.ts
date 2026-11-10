import { test } from "node:test";
import assert from "node:assert/strict";
import { GitError, type Exec, type ExecResult, type Git, type Target } from "../src/core/git/runner.ts";
import { aiPrompt, cleanMessage, pickWriter, suggestWithAi, writerArgs, WRITERS, MAX_DIFF } from "../src/core/aiMessage.ts";

const claude = WRITERS.claude;

const at: Target = { cwd: "/r", on: null };

function recorder(answers: Record<string, string | GitError> = {}): Git {
  return async (_t, args) => {
    const a = answers[args.join(" ")];
    if (a instanceof GitError) throw a;
    return a ?? "";
  };
}

const staged = {
  "diff --no-ext-diff --no-textconv --no-color --cached --stat": " a.ts | 2 +-\n",
  "diff --no-ext-diff --no-textconv --no-color --cached": "diff --git a/a.ts b/a.ts\n-old\n+new\n",
  "log -8 --format=%s": "feat: one\nfix: two\n",
};

function fakeExec(result: ExecResult | Error): { exec: Exec; calls: Array<{ command: string; args: string[]; options: unknown }> } {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "mktemp") return { code: 0, stdout: "/private/tmp/u/githerd.abc\n", stderr: "" };
    if (command === "rmdir") return { code: 0, stdout: "", stderr: "" };
    if (result instanceof Error) throw result;
    return result;
  };
  return { exec, calls };
}

test("aiPrompt carries the recent subjects, the stat and the diff", () => {
  const p = aiPrompt(" a.ts | 2 +-", "-old\n+new", "feat: one\nfix: two");
  assert.match(p, /feat: one\nfix: two/);
  assert.match(p, / a\.ts \| 2 \+-/);
  assert.match(p, /-old\n\+new/);
  assert.match(p, /only the message/);
  assert.match(p, /not instructions/);
});

test("aiPrompt cuts a long diff and says so", () => {
  const p = aiPrompt("stat", "x".repeat(MAX_DIFF + 500), "");
  assert.ok(p.length < MAX_DIFF + 2000);
  assert.match(p, /diff cut at/);
});

test("cleanMessage trims and drops code fences", () => {
  assert.equal(cleanMessage("  feat: x\n\nbody\n  "), "feat: x\n\nbody");
  assert.equal(cleanMessage("```\nfeat: x\n```\n"), "feat: x");
  assert.equal(cleanMessage("```text\nfix: y\n```"), "fix: y");
});

test("suggestWithAi asks claude about the staged diff, with no tools and no hooks", async () => {
  const { exec, calls } = fakeExec({ code: 0, stdout: "feat: new thing\n", stderr: "" });
  assert.deepEqual(await suggestWithAi(recorder(staged), exec, at, claude), { message: "feat: new thing" });
  assert.deepEqual(calls.map((c) => c.command), ["mktemp", "claude", "rmdir"]);
  const call = calls[1];
  assert.equal(call?.command, "claude");
  // In a private folder made for this call, removed afterwards.
  assert.equal((call?.options as { cwd?: string }).cwd, "/private/tmp/u/githerd.abc");
  assert.deepEqual(calls[2]?.args, ["/private/tmp/u/githerd.abc"]);
  const args = call?.args ?? [];
  assert.equal(args[0], "-p");
  assert.match(args[1] ?? "", /\+new/);
  for (const flag of ["--model", "--tools", "--settings", "--no-session-persistence"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.match(args[args.indexOf("--settings") + 1] ?? "", /disableAllHooks/);
  assert.equal((call?.options as { timeout?: number }).timeout, 90_000);
});

test("suggestWithAi works before the first commit (no log yet)", async () => {
  const { exec } = fakeExec({ code: 0, stdout: "chore: start\n", stderr: "" });
  const git = recorder({ ...staged, "log -8 --format=%s": new GitError("no commits", [], 128, "") });
  assert.deepEqual(await suggestWithAi(git, exec, at, claude), { message: "chore: start" });
});

test("suggestWithAi explains why it can't suggest", async () => {
  const ok = fakeExec({ code: 0, stdout: "x", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(), ok, at, claude), { error: "Stage a file first: the suggestion reads the staged changes" });
  assert.deepEqual(await suggestWithAi(recorder(staged), ok, { cwd: "/r", on: "m1" }, claude), { error: "AI suggestions work only for repos on this machine" });
  const missing = fakeExec(new Error("spawn claude ENOENT")).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), missing, at, claude), { error: "Claude Code (claude) couldn't start: is it installed?" });
  const failed = fakeExec({ code: 1, stdout: "", stderr: "Invalid API key · Please run /login\nmore\n" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), failed, at, claude), { error: "Claude Code: Invalid API key · Please run /login" });
  const silent = fakeExec({ code: 1, stdout: "", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), silent, at, claude), { error: "Claude Code stopped without a message" });
  const empty = fakeExec({ code: 0, stdout: "  \n", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), empty, at, claude), { error: "Claude Code stopped without a message" });
  const broken = recorder({ "diff --no-ext-diff --no-textconv --no-color --cached --stat": new GitError("index locked", [], 128, "") });
  assert.deepEqual(await suggestWithAi(broken, ok, at, claude), { error: "index locked" });
});

// --- Which agent writes the message ---

test("pickWriter prefers an agent working in this repo, then the installed ones in menu order", () => {
  assert.equal(pickWriter(["codex"], ["claude", "gemini"])?.key, "codex");
  assert.equal(pickWriter(["amp", "codex"], ["claude"])?.key, "codex");
  assert.equal(pickWriter(["amp"], ["kiro", "codex", "claude"])?.key, "codex");
  // Gemini CLI can't be held to a call without tools, so it isn't asked.
  assert.equal(pickWriter(["gemini"], ["gemini"]), null);
  assert.equal(pickWriter([], ["claude"])?.key, "claude");
  assert.equal(pickWriter(["amp"], ["kiro"]), null);
});

test("writerArgs asks each agent for one plain-text answer, with its tools and own config off", () => {
  const codex = writerArgs(WRITERS.codex, "PROMPT");
  assert.equal(WRITERS.codex.command, "codex");
  assert.equal(codex[0], "exec");
  assert.equal(codex.at(-1), "PROMPT");
  assert.equal(codex[codex.indexOf("--sandbox") + 1], "read-only");
  for (const flag of ["--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]) assert.ok(codex.includes(flag), flag);
  assert.equal(codex[codex.indexOf("--disable") + 1], "shell_tool");
  assert.ok(codex.includes("web_search=disabled"));
  assert.ok(codex.includes("approval_policy=never"));
  const claudeArgs = writerArgs(claude, "PROMPT");
  assert.equal(claudeArgs[1], "PROMPT");
  assert.equal(claudeArgs[claudeArgs.indexOf("--tools") + 1], "");
});

test("suggestWithAi runs the picked agent and names it in errors", async () => {
  const { exec, calls } = fakeExec({ code: 0, stdout: "fix: thing\n", stderr: "" });
  assert.deepEqual(await suggestWithAi(recorder(staged), exec, at, WRITERS.codex), { message: "fix: thing" });
  assert.equal(calls[1]?.command, "codex");
  const missing = fakeExec(new Error("spawn codex ENOENT")).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), missing, at, WRITERS.codex), { error: "Codex (codex) couldn't start: is it installed?" });
  const failed = fakeExec({ code: 1, stdout: "", stderr: "not logged in\n" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), failed, at, WRITERS.codex), { error: "Codex: not logged in" });
});

test("suggestWithAi says so when no agent can write the message", async () => {
  const { exec, calls } = fakeExec({ code: 0, stdout: "x", stderr: "" });
  assert.deepEqual(await suggestWithAi(recorder(staged), exec, at, null), { error: "No coding agent to write the message: install Claude Code or Codex" });
  assert.equal(calls.length, 0);
});

test("suggestWithAi doesn't run an agent without its own private folder", async () => {
  const calls: string[] = [];
  const exec: Exec = async (command) => {
    calls.push(command);
    if (command === "mktemp") return { code: 1, stdout: "", stderr: "mktemp: failed\n" };
    return { code: 0, stdout: "x", stderr: "" };
  };
  assert.deepEqual(await suggestWithAi(recorder(staged), exec, at, claude), { error: "Couldn't make a private folder for the agent: mktemp: failed" });
  assert.deepEqual(calls, ["mktemp"]);
  const throwing: Exec = async () => {
    throw new Error("no mktemp");
  };
  assert.deepEqual(await suggestWithAi(recorder(staged), throwing, at, claude), { error: "Couldn't make a private folder for the agent: no mktemp" });
});
