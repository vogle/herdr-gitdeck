import { test } from "node:test";
import assert from "node:assert/strict";
import type { Exec, Git } from "../src/core/git/runner.ts";
import { forgeOf, parseRemote } from "../src/core/forge/remote.ts";
import { parseBranchPr, parsePrs, prListArgs, prViewArgs } from "../src/core/forge/github.ts";
import { mrListArgs, mrViewArgs, parseBranchMr, parseMrs } from "../src/core/forge/gitlab.ts";
import { loadBranchPr, loadPrs } from "../src/core/forge/index.ts";

const T = { cwd: "/r", on: null };

test("parseRemote reads host and path from the usual remote URL shapes", () => {
  assert.deepEqual(parseRemote("https://github.com/vogle/herdr-gitdeck.git"), { host: "github.com", path: "vogle/herdr-gitdeck" });
  assert.deepEqual(parseRemote("git@github.com:vogle/x.y"), { host: "github.com", path: "vogle/x.y" });
  assert.deepEqual(parseRemote("ssh://git@github.com/a/b.git"), { host: "github.com", path: "a/b" });
  assert.deepEqual(parseRemote("ssh://git@gitlab.example.io:2222/grp/sub/app.git\n"), { host: "gitlab.example.io", path: "grp/sub/app" });
  assert.deepEqual(parseRemote("https://user@gitlab.com/grp/app/"), { host: "gitlab.com", path: "grp/app" });
  assert.equal(parseRemote("https://github.com/-a/b"), null, "no leading dash: it would read as a flag");
  assert.equal(parseRemote("/srv/git/a.git"), null);
  assert.equal(parseRemote(""), null);
});

test("forgeOf knows github.com and gitlab.com; any other host only by the override", () => {
  assert.deepEqual(forgeOf(parseRemote("git@github.com:a/b.git"), null), { kind: "github", label: "PR", cli: "gh", repo: "a/b" });
  assert.equal(forgeOf(parseRemote("https://github.com/a/b/c"), null), null, "a GitHub repo is owner/name");
  assert.equal(forgeOf(parseRemote("https://github.corp.io/a/b"), null), null, "a look-alike host is never guessed");
  assert.equal(forgeOf(parseRemote("https://github.com.evil.io/a/b"), null), null);
  assert.deepEqual(forgeOf(parseRemote("https://github.corp.io/a/b"), "github"), { kind: "github", label: "PR", cli: "gh", repo: "github.corp.io/a/b" });
  assert.deepEqual(forgeOf(parseRemote("git@gitlab.com:g/s/app.git"), null), { kind: "gitlab", label: "MR", cli: "glab", repo: "g/s/app" });
  assert.equal(forgeOf(parseRemote("https://gitlab.acme.dev/g/app"), null), null);
  assert.deepEqual(forgeOf(parseRemote("https://gitlab.acme.dev/g/app"), "gitlab"), { kind: "gitlab", label: "MR", cli: "glab", repo: "https://gitlab.acme.dev/g/app" });
  assert.equal(forgeOf(parseRemote("https://git.acme.dev/g/app"), null), null, "an unknown host needs the override");
  assert.equal(forgeOf(parseRemote("https://git.acme.dev/g/app"), "gitlab")?.repo, "https://git.acme.dev/g/app");
  assert.equal(forgeOf(parseRemote("https://git.acme.dev/g/app"), "github")?.repo, "git.acme.dev/g/app");
  assert.equal(forgeOf(parseRemote("https://git.acme.dev/g/app"), "bitbucket"), null);
  assert.equal(forgeOf(null, "github"), null);
});

test("GitHub: the list and view name the repo, so gh never reads the work tree", () => {
  assert.deepEqual(prListArgs("a/b").slice(0, 4), ["pr", "list", "--repo", "a/b"]);
  assert.deepEqual(prViewArgs("o/r", "feat/x"), [
    "pr", "view", "feat/x", "--repo", "o/r", "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup",
  ]);
});

test("parsePrs keeps well-formed entries and rejects anything else", () => {
  const json = JSON.stringify([
    { number: 7, title: "Fix", state: "OPEN", isDraft: false, headRefName: "fix", headRefOid: "a".repeat(40), author: { login: "ann" }, updatedAt: "2026-11-01T00:00:00Z" },
    { number: "x" },
  ]);
  assert.deepEqual(parsePrs(json), [{ number: 7, title: "Fix", state: "OPEN", draft: false, branch: "fix", head: "a".repeat(40), author: "ann", updated: Date.UTC(2026, 10, 1) / 1000 }]);
  assert.throws(() => parsePrs("not json"));
  assert.deepEqual(parsePrs("{}"), []);
});

test("parseBranchPr counts passed, failed and running checks", () => {
  const pr = parseBranchPr(JSON.stringify({
    number: 7, title: "Add X", state: "OPEN", isDraft: false, url: "u", reviewDecision: "APPROVED",
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
  assert.deepEqual(pr, { number: 7, title: "Add X", state: "OPEN", draft: false, url: "u", review: "APPROVED", checks: { passed: 3, failed: 2, pending: 2 } });
  assert.equal(parseBranchPr("[]"), null);
});

test("GitLab: glab lists and views merge requests as JSON for the named project", () => {
  assert.deepEqual(mrListArgs("g/app"), ["mr", "list", "--repo", "g/app", "--all", "--per-page", "100", "--output", "json"]);
  assert.deepEqual(mrViewArgs("g/app", "feat/x"), ["mr", "view", "feat/x", "--repo", "g/app", "--output", "json"]);
});

test("parseMrs reads glab's merge requests in the shared shape", () => {
  const json = JSON.stringify([
    { iid: 4, title: "Draft: Add", state: "opened", draft: true, source_branch: "add", sha: "b".repeat(40), author: { username: "bo" }, updated_at: "2026-11-02T00:00:00Z" },
    { iid: 5, title: "Done", state: "merged", draft: false, source_branch: "d", sha: "c".repeat(40), author: { username: "cy" }, updated_at: "bad" },
    { title: "no iid" },
  ]);
  assert.deepEqual(parseMrs(json), [
    { number: 4, title: "Draft: Add", state: "OPEN", draft: true, branch: "add", head: "b".repeat(40), author: "bo", updated: Date.UTC(2026, 10, 2) / 1000 },
    { number: 5, title: "Done", state: "MERGED", draft: false, branch: "d", head: "c".repeat(40), author: "cy", updated: 0 },
  ]);
  assert.deepEqual(parseMrs("{}"), []);
});

test("parseBranchMr turns the head pipeline into check counts", () => {
  const mr = (status: string | null, extra = {}) => JSON.stringify({ iid: 9, title: "t", state: "closed", draft: false, web_url: "w", head_pipeline: status ? { status } : null, ...extra });
  assert.deepEqual(parseBranchMr(mr("success", { approved: true })), { number: 9, title: "t", state: "CLOSED", draft: false, url: "w", review: "APPROVED", checks: { passed: 1, failed: 0, pending: 0 } });
  assert.deepEqual(parseBranchMr(mr("failed"))?.checks, { passed: 0, failed: 1, pending: 0 });
  assert.deepEqual(parseBranchMr(mr("running"))?.checks, { passed: 0, failed: 0, pending: 1 });
  assert.deepEqual(parseBranchMr(mr(null))?.checks, { passed: 0, failed: 0, pending: 0 });
  assert.equal(parseBranchMr("[]"), null);
});

/** A git that answers the remote URL and (optionally) the forge override. */
const gitFor = (url: string, forge: string | null = null): Git => async (_t, args) => {
  if (args[0] === "remote") return `${url}\n`;
  if (args.includes("gitdeck.forge") && forge !== null) return `${forge}\n`;
  throw new Error("not set");
};

test("loadPrs runs the forge's CLI outside the repo and labels the list", async () => {
  const calls: [string, string[], unknown][] = [];
  const spy: Exec = async (c, a, o) => {
    calls.push([c, a, o]);
    return { code: 0, stdout: "[]", stderr: "" };
  };
  assert.deepEqual(await loadPrs(gitFor("git@github.com:a/b.git"), spy, T, "/home"), { items: [], error: null, repo: "a/b", label: "PR" });
  assert.deepEqual(calls[0]?.[0], "gh");
  assert.deepEqual(calls[0]?.[2], { cwd: "/home", on: null }, "the CLI runs outside the repo");
  assert.equal((await loadPrs(gitFor("https://git.acme.dev/g/app", "gitlab"), spy, T, "/home")).label, "MR");
  assert.equal(calls[1]?.[0], "glab");
});

test("loadPrs reports a missing forge, a failing or missing CLI", async () => {
  const ok: Exec = async () => ({ code: 0, stdout: "[]", stderr: "" });
  assert.match((await loadPrs(gitFor("https://git.acme.dev/g/app"), ok, T, "/home")).error ?? "", /GitHub or GitLab remote/);
  const bad: Exec = async () => ({ code: 1, stdout: "", stderr: "gh auth login required\nmore" });
  assert.equal((await loadPrs(gitFor("https://github.com/a/b"), bad, T, "/home")).error, "gh auth login required");
  const missing: Exec = async () => {
    throw new Error("spawn glab ENOENT");
  };
  assert.match((await loadPrs(gitFor("https://gitlab.com/a/b"), missing, T, "/home")).error ?? "", /Can't run glab/);
  const noRemote: Git = async () => {
    throw new Error("No such remote 'origin'");
  };
  assert.match((await loadPrs(noRemote, ok, T, "/home")).error ?? "", /GitHub or GitLab remote/);
});

test("loadBranchPr: none without a forge or a PR/MR, an error when the CLI fails", async () => {
  const none: Exec = async () => ({ code: 1, stdout: "", stderr: 'no pull requests found for branch "x"\n' });
  assert.deepEqual(await loadBranchPr(gitFor("git@github.com:o/r.git"), none, T, "/home", "x"), { pr: null, error: null, label: "PR" });
  const noMr: Exec = async () => ({ code: 1, stdout: "", stderr: "no open merge request available for \"x\"\n" });
  assert.deepEqual(await loadBranchPr(gitFor("git@gitlab.com:o/r.git"), noMr, T, "/home", "x"), { pr: null, error: null, label: "MR" });
  const broken: Exec = async () => ({ code: 4, stdout: "", stderr: "gh: To get started, run gh auth login\n" });
  assert.equal((await loadBranchPr(gitFor("git@github.com:o/r.git"), broken, T, "/home", "x")).error, "gh: To get started, run gh auth login");
  const ok: Exec = async () => ({ code: 0, stdout: JSON.stringify({ iid: 3, title: "t", state: "opened", web_url: "w" }), stderr: "" });
  assert.equal((await loadBranchPr(gitFor("git@gitlab.com:o/r.git"), ok, T, "/home", "x")).pr?.number, 3);
  assert.deepEqual(await loadBranchPr(gitFor("https://git.acme.dev/o/r"), ok, T, "/home", "x"), { pr: null, error: null, label: "PR" });
  const gone: Exec = async () => {
    throw new Error("spawn gh ENOENT");
  };
  assert.match((await loadBranchPr(gitFor("git@github.com:o/r.git"), gone, T, "/home", "x")).error ?? "", /Can't run gh/);
});
