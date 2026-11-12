import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOW_KINDS, flowBase, flowBranch } from "../src/core/flow.ts";
import { statsArgs, parseStats, loadStats } from "../src/core/stats.ts";

test("git-flow: features and releases start from develop, hotfixes from main or master", () => {
  assert.deepEqual(FLOW_KINDS, ["feature", "release", "hotfix"]);
  assert.equal(flowBase("feature", ["main", "develop"]), "develop");
  assert.equal(flowBase("release", ["master", "develop"]), "develop");
  assert.equal(flowBase("hotfix", ["develop", "master"]), "master");
  assert.equal(flowBase("hotfix", ["main", "master"]), "main");
  assert.equal(flowBase("feature", ["main"]), null, "no develop: no git-flow");
  assert.equal(flowBase("hotfix", ["develop"]), null);
  assert.equal(flowBranch("feature", "login"), "feature/login");
});

const A = "a".repeat(40);
test("stats: commits, authors by count, months, first and last", () => {
  assert.deepEqual(statsArgs().slice(0, 3), ["log", "--no-show-signature", "--no-merges"]);
  const day = 86400;
  const t0 = Date.UTC(2026, 0, 15) / 1000;
  const t1 = Date.UTC(2026, 2, 1) / 1000;
  const out = [`Ann\x1fa@x\x1f${t1}`, `Bob\x1fb@x\x1f${t0 + day}`, `Ann\x1fa@x\x1f${t0}`, "junk", ""].join("\n");
  const s = parseStats(out, 42);
  assert.equal(s.commits, 3);
  assert.equal(s.files, 42);
  assert.deepEqual(s.authors, [{ name: "Ann", email: "a@x", count: 2 }, { name: "Bob", email: "b@x", count: 1 }]);
  assert.deepEqual(s.months, [{ month: "2026-01", count: 2 }, { month: "2026-02", count: 0 }, { month: "2026-03", count: 1 }]);
  assert.equal(s.first, t0);
  assert.equal(s.last, t1);
  assert.deepEqual(parseStats("", 0).months, []);
});

test("loadStats reads the log and the file list, and reports an error as text", async () => {
  const at = { cwd: "/r", on: null };
  const git = async (_t: unknown, args: string[]) => (args[0] === "ls-files" ? "a\x00b\x00" : `Ann\x1fa@x\x1f100\n`);
  const s = await loadStats(git, at);
  assert.equal(s.files, 2);
  assert.equal(s.commits, 1);
  assert.equal(s.error, null);
  const failing = async () => {
    throw new Error("no HEAD");
  };
  assert.equal((await loadStats(failing, at)).error, "no HEAD");
});

test("git-flow buttons show only in a repo that uses it (has develop)", async () => {
  const { flowKinds } = await import("../src/core/flow.ts");
  assert.deepEqual(flowKinds(["main", "feat/x"]), [], "a main-only repo gets no + hotfix");
  assert.deepEqual(flowKinds(["main", "develop"]), ["feature", "release", "hotfix"]);
  assert.deepEqual(flowKinds(["develop"]), ["feature", "release"]);
});
