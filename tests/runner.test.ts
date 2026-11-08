import { test } from "node:test";
import assert from "node:assert/strict";
import { createGit, GitError, GIT_FLAGS, type Exec } from "../src/core/git/runner.ts";

const recorder = (result: { code: number; stdout: string; stderr: string }) => {
  const calls: { cmd: string; args: string[]; opts: { cwd?: string; on?: string | null } }[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return result;
  };
  return { exec, calls };
};

test("runs git with the safe flags, in the folder and on the machine given", async () => {
  const { exec, calls } = recorder({ code: 0, stdout: "main\n", stderr: "" });
  const git = createGit(exec);
  const out = await git({ cwd: "/r", on: "box" }, ["branch", "--show-current"]);
  assert.equal(out, "main\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cmd, "git");
  assert.deepEqual(calls[0]?.args, [...GIT_FLAGS, "branch", "--show-current"]);
  assert.deepEqual(calls[0]?.opts, { cwd: "/r", on: "box" });
});

test("with environment settings, git runs through env with them first", async () => {
  const { exec, calls } = recorder({ code: 0, stdout: "", stderr: "" });
  await createGit(exec, ["GIT_TERMINAL_PROMPT=0"])({ cwd: "/r", on: null }, ["fetch"]);
  assert.equal(calls[0]?.cmd, "env");
  assert.deepEqual(calls[0]?.args, ["GIT_TERMINAL_PROMPT=0", "git", ...GIT_FLAGS, "fetch"]);
});

test("a repo's own config can't make githerd run a program (fsmonitor off)", () => {
  const flags = GIT_FLAGS.join(" ");
  assert.match(flags, /-c core\.fsmonitor=false/);
  assert.match(flags, /-c log\.showSignature=false/);
  assert.ok(GIT_FLAGS.includes("--literal-pathspecs"), "a path is never a pattern");
});

test("a nonzero exit becomes a GitError carrying stderr's first line", async () => {
  const { exec } = recorder({ code: 128, stdout: "", stderr: "fatal: not a git repository\nmore\n" });
  const git = createGit(exec);
  await assert.rejects(
    () => git({ cwd: "/x", on: null }, ["status"]),
    (e: unknown) =>
      e instanceof GitError &&
      e.code === 128 &&
      e.message === "fatal: not a git repository" &&
      e.stderr.includes("more") &&
      e.args.join(" ") === "status",
  );
});

test("a nonzero exit with no stderr still says which command failed", async () => {
  const { exec } = recorder({ code: 1, stdout: "", stderr: "" });
  await assert.rejects(() => createGit(exec)({ cwd: "/x", on: null }, ["diff", "--quiet"]), /git diff --quiet exited 1/);
});

test("a program that can't start becomes a GitError with code -1", async () => {
  const exec: Exec = async () => {
    throw new Error("machine unreachable");
  };
  await assert.rejects(
    () => createGit(exec)({ cwd: "/x", on: "far" }, ["status"]),
    (e: unknown) => e instanceof GitError && e.code === -1 && e.message === "machine unreachable",
  );
});
