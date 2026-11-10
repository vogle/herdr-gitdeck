import { test } from "node:test";
import assert from "node:assert/strict";
import { GitError, type Exec, type ExecResult, type Git, type Target } from "../src/core/git/runner.ts";
import { aiPrompt, cleanMessage, suggestWithAi, MAX_DIFF } from "../src/core/aiMessage.ts";

const at: Target = { cwd: "/r", on: null };

function recorder(answers: Record<string, string | GitError> = {}): Git {
  return async (_t, args) => {
    const a = answers[args.join(" ")];
    if (a instanceof GitError) throw a;
    return a ?? "";
  };
}

const staged = {
  "diff --cached --stat": " a.ts | 2 +-\n",
  "diff --cached": "diff --git a/a.ts b/a.ts\n-old\n+new\n",
  "log -8 --format=%s": "feat: one\nfix: two\n",
};

function fakeExec(result: ExecResult | Error): { exec: Exec; calls: Array<{ command: string; args: string[]; options: unknown }> } {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const exec: Exec = async (command, args, options) => {
    calls.push({ command, args, options });
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
  assert.deepEqual(await suggestWithAi(recorder(staged), exec, at), { message: "feat: new thing" });
  const call = calls[0];
  assert.equal(call?.command, "claude");
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
  assert.deepEqual(await suggestWithAi(git, exec, at), { message: "chore: start" });
});

test("suggestWithAi explains why it can't suggest", async () => {
  const ok = fakeExec({ code: 0, stdout: "x", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(), ok, at), { error: "Stage a file first: the suggestion reads the staged changes" });
  assert.deepEqual(await suggestWithAi(recorder(staged), ok, { cwd: "/r", on: "m1" }), { error: "AI suggestions work only for repos on this machine" });
  const missing = fakeExec(new Error("spawn claude ENOENT")).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), missing, at), { error: "Claude Code (claude) couldn't start: is it installed?" });
  const failed = fakeExec({ code: 1, stdout: "", stderr: "Invalid API key · Please run /login\nmore\n" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), failed, at), { error: "Claude Code: Invalid API key · Please run /login" });
  const silent = fakeExec({ code: 1, stdout: "", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), silent, at), { error: "Claude Code stopped without a message" });
  const empty = fakeExec({ code: 0, stdout: "  \n", stderr: "" }).exec;
  assert.deepEqual(await suggestWithAi(recorder(staged), empty, at), { error: "Claude Code stopped without a message" });
  const broken = recorder({ "diff --cached --stat": new GitError("index locked", [], 128, "") });
  assert.deepEqual(await suggestWithAi(broken, ok, at), { error: "index locked" });
});
