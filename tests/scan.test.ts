import { test } from "node:test";
import assert from "node:assert/strict";
import { scanHerd, loadStatus } from "../src/core/scan.ts";
import { GitError, type Exec, type Git } from "../src/core/git/runner.ts";

const gitFor = (toplevels: Record<string, string>, status = "# branch.head main\0"): Git => async (target, args) => {
  if (args[0] === "rev-parse") {
    const top = toplevels[target.cwd];
    if (!top) throw new GitError("fatal: not a git repository", args, 128, "");
    return `${top}\n`;
  }
  if (args[0] === "status") return status;
  throw new Error(`unexpected git ${args.join(" ")}`);
};

const findPrints = (stdout: string, code = 0) => {
  const calls: { cmd: string; args: string[]; on: string | null | undefined }[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, on: opts.on });
    return { code, stdout, stderr: "" };
  };
  return { exec, calls };
};

test("scanHerd finds the root, then the repos below it on the same machine", async () => {
  const { exec, calls } = findPrints("/w/h/.git\n/w/h/a/.git\n");
  const r = await scanHerd({ git: gitFor({ "/w/h/a": "/w/h/a", "/w/h": "/w/h" }), exec, home: "/Users/me", depth: 3 }, { cwd: "/w/h/a", on: "box" });
  assert.deepEqual(r, {
    root: "/w/h",
    rootIsRepo: true,
    focused: "/w/h/a",
    repos: [{ path: "/w/h/a", name: "a", group: "" }],
    truncated: false,
    error: null,
  });
  assert.equal(calls[0]?.cmd, "find");
  assert.equal(calls[0]?.on, "box");
});

test("find exiting nonzero (an unreadable folder) still uses what it printed", async () => {
  const { exec } = findPrints("/w/many/x/.git\n", 1);
  const r = await scanHerd({ git: gitFor({}), exec, home: "/Users/me", depth: 2 }, { cwd: "/w/many", on: null });
  assert.deepEqual(r.repos.map((x) => x.name), ["x"]);
  assert.equal(r.rootIsRepo, false);
  assert.equal(r.error, null);
});

test("a folder at or above home that isn't a repo is never searched", async () => {
  const { exec, calls } = findPrints("/Users/me/x/.git\n");
  const r = await scanHerd({ git: gitFor({}), exec, home: "/Users/me", depth: 3 }, { cwd: "/Users/me", on: null });
  assert.deepEqual(r, { root: "/Users/me", rootIsRepo: false, focused: null, repos: [], truncated: false, error: null });
  assert.equal(calls.length, 0);
  const above = await scanHerd({ git: gitFor({}), exec, home: "/Users/me", depth: 3 }, { cwd: "/Users", on: null });
  assert.deepEqual(above.repos, []);
});

test("find that can't start keeps the root and says why", async () => {
  const exec: Exec = async () => {
    throw new Error("machine unreachable");
  };
  const r = await scanHerd({ git: gitFor({ "/w/h": "/w/h" }), exec, home: "/Users/me", depth: 3 }, { cwd: "/w/h", on: null });
  assert.deepEqual(r.repos, []);
  assert.equal(r.rootIsRepo, true);
  assert.equal(r.error, "Couldn't search /w/h for repositories: machine unreachable");
});

test("a herd over the limit says so", async () => {
  const lines = Array.from({ length: 600 }, (_, i) => `/w/h/r${String(i).padStart(3, "0")}/.git`).join("\n");
  const { exec } = findPrints(lines);
  const r = await scanHerd({ git: gitFor({ "/w/h": "/w/h" }), exec, home: "/Users/me", depth: 3 }, { cwd: "/w/h", on: null });
  assert.equal(r.repos.length, 500);
  assert.equal(r.truncated, true);
});

test("loadStatus parses status, or reports the error", async () => {
  const ok = await loadStatus(gitFor({}, "# branch.head dev\0"), { cwd: "/r", on: null });
  assert.equal(ok.status?.branch, "dev");
  assert.equal(ok.error, null);
  const failing: Git = async () => {
    throw new GitError("fatal: bad", [], 128, "");
  };
  assert.deepEqual(await loadStatus(failing, { cwd: "/r", on: null }), { status: null, error: "fatal: bad" });
  const throwsPlain: Git = async () => {
    throw "weird";
  };
  assert.deepEqual(await loadStatus(throwsPlain, { cwd: "/r", on: null }), { status: null, error: "weird" });
});
