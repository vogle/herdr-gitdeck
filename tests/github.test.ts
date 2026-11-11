import { test } from "node:test";
import assert from "node:assert/strict";
import { githubRepo, prListArgs, parsePrs, loadPrs } from "../src/core/github.ts";

test("githubRepo reads owner/repo from the usual remote URL shapes, and nothing else", () => {
  assert.equal(githubRepo("https://github.com/vogle/herdr-gitdeck.git"), "vogle/herdr-gitdeck");
  assert.equal(githubRepo("git@github.com:vogle/x.y"), "vogle/x.y");
  assert.equal(githubRepo("ssh://git@github.com/a/b.git"), "a/b");
  assert.equal(githubRepo("https://gitlab.com/a/b.git"), null);
  assert.equal(githubRepo("https://github.com/a/b/c"), null);
  assert.equal(githubRepo("https://github.com/-a/b"), null, "no leading dash: it would read as a flag");
});

test("the PR list names the repo, so gh never reads the work tree", () => {
  const args = prListArgs("a/b");
  assert.deepEqual(args.slice(0, 4), ["pr", "list", "--repo", "a/b"]);
  assert.ok(args.includes("--json"));
});

test("parsePrs keeps well-formed entries and rejects anything else", () => {
  const json = JSON.stringify([
    { number: 7, title: "Fix", state: "OPEN", isDraft: false, headRefName: "fix", headRefOid: "a".repeat(40), author: { login: "ann" }, updatedAt: "2026-11-01T00:00:00Z", url: "https://github.com/a/b/pull/7" },
    { number: "x" },
  ]);
  assert.deepEqual(parsePrs(json), [{ number: 7, title: "Fix", state: "OPEN", draft: false, branch: "fix", head: "a".repeat(40), author: "ann", updated: Date.UTC(2026, 10, 1) / 1000 }]);
  assert.throws(() => parsePrs("not json"));
  assert.deepEqual(parsePrs("{}"), []);
});

test("loadPrs: no GitHub remote, gh missing or failing, and success", async () => {
  const at = { cwd: "/r", on: null };
  const git = (url: string) => async () => url;
  const ok = async () => ({ code: 0, stdout: "[]", stderr: "" });
  assert.match((await loadPrs(git("https://gitlab.com/a/b"), ok, at, "/home")).error ?? "", /GitHub remote/);
  const calls: [string, string[], unknown][] = [];
  const spy = async (c: string, a: string[], o: unknown) => { calls.push([c, a, o]); return { code: 0, stdout: "[]", stderr: "" }; };
  const r = await loadPrs(git("git@github.com:a/b.git\n"), spy, at, "/home");
  assert.deepEqual(r, { items: [], error: null, repo: "a/b" });
  assert.deepEqual(calls[0]?.[2], { cwd: "/home", on: null }, "gh runs outside the repo");
  const bad = async () => ({ code: 1, stdout: "", stderr: "gh auth login required\nmore" });
  assert.equal((await loadPrs(git("https://github.com/a/b"), bad, at, "/home")).error, "gh auth login required");
  const missing = async () => { throw new Error("spawn gh ENOENT"); };
  assert.match((await loadPrs(git("https://github.com/a/b"), missing, at, "/home")).error ?? "", /gh/);
  const noRemote = async () => { throw new Error("No such remote 'origin'"); };
  assert.match((await loadPrs(noRemote, ok, at, "/home")).error ?? "", /GitHub remote/);
});

test("prViewArgs asks gh for the branch's PR with its checks", async () => {
  const { prViewArgs } = await import("../src/core/github.ts");
  assert.deepEqual(prViewArgs("o/r", "feat/x"), [
    "pr", "view", "feat/x", "--repo", "o/r", "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup",
  ]);
});

test("parseBranchPr counts passed, failed and running checks", async () => {
  const { parseBranchPr } = await import("../src/core/github.ts");
  const pr = parseBranchPr(JSON.stringify({
    number: 7, title: "Add X", state: "OPEN", isDraft: false, url: "https://github.com/o/r/pull/7", reviewDecision: "APPROVED",
    statusCheckRollup: [
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "StatusContext", state: "SUCCESS" },
      { __typename: "StatusContext", state: "PENDING" },
      { __typename: "StatusContext", state: "ERROR" },
    ],
  }));
  assert.deepEqual(pr, {
    number: 7, title: "Add X", state: "OPEN", draft: false, url: "https://github.com/o/r/pull/7", review: "APPROVED",
    checks: { passed: 3, failed: 2, pending: 2 },
  });
  assert.equal(parseBranchPr("[]"), null);
});

test("loadBranchPr: none when the branch has no PR, an error when gh fails", async () => {
  const { loadBranchPr } = await import("../src/core/github.ts");
  const T = { cwd: "/r", on: null };
  const origin = async () => "git@github.com:o/r.git\n";
  const none = async () => ({ code: 1, stdout: "", stderr: 'no pull requests found for branch "x"\n' });
  assert.deepEqual(await loadBranchPr(origin, none, T, "/home", "x"), { pr: null, error: null });
  const broken = async () => ({ code: 4, stdout: "", stderr: "gh: To get started, run gh auth login\n" });
  assert.deepEqual(await loadBranchPr(origin, broken, T, "/home", "x"), { pr: null, error: "gh: To get started, run gh auth login" });
  const ok = async () => ({ code: 0, stdout: JSON.stringify({ number: 1, title: "t", state: "MERGED", isDraft: true, url: "u", reviewDecision: "", statusCheckRollup: [] }), stderr: "" });
  assert.equal((await loadBranchPr(origin, ok, T, "/home", "x")).pr?.number, 1);
  const elsewhere = async () => "https://gitlab.com/o/r.git\n";
  assert.deepEqual(await loadBranchPr(elsewhere, ok, T, "/home", "x"), { pr: null, error: null }, "no GitHub remote: nothing to show");
});
