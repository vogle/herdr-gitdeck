import { test } from "node:test";
import assert from "node:assert/strict";
import type { Exec, Git } from "../src/core/git/runner.ts";
import { forgeOf, parseRemote } from "../src/core/forge/remote.ts";
import { parseBranchPr, parsePrs, prListArgs, prViewArgs } from "../src/core/forge/github.ts";
import { failedJobsArgs, mrListArgs, mrViewArgs, parseBranchMr, parseFailedJobs, parseMrs, pipelineId } from "../src/core/forge/gitlab.ts";
import { loadBranchPr, loadPrs, setForge } from "../src/core/forge/index.ts";

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
    "pr", "view", "feat/x", "--repo", "o/r", "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup,baseRefName",
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
    number: 7, title: "Add X", state: "OPEN", isDraft: false, url: "u", reviewDecision: "APPROVED", baseRefName: "develop",
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
  assert.deepEqual(pr, { number: 7, title: "Add X", state: "OPEN", draft: false, url: "u", review: "APPROVED", checks: { passed: 3, failed: 2, pending: 2 }, target: "develop", failed: [{ name: "", url: "", log: null }, { name: "", url: "", log: null }] });
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
  const mr = (status: string | null, extra = {}) => JSON.stringify({ iid: 9, title: "t", state: "closed", draft: false, web_url: "w", target_branch: "release/1", head_pipeline: status ? { status } : null, ...extra });
  assert.deepEqual(parseBranchMr(mr("success", { approved: true })), { number: 9, title: "t", state: "CLOSED", draft: false, url: "w", review: "APPROVED", checks: { passed: 1, failed: 0, pending: 0 }, target: "release/1", failed: [] });
  assert.deepEqual(parseBranchMr(mr("failed"))?.checks, { passed: 0, failed: 1, pending: 0 });
  assert.deepEqual(parseBranchMr(mr("running"))?.checks, { passed: 0, failed: 0, pending: 1 });
  assert.deepEqual(parseBranchMr(mr(null))?.checks, { passed: 0, failed: 0, pending: 0 });
  assert.equal(parseBranchMr("[]"), null);
});

test("parseBranchPr lists each failed check: its name, page, and the gh command for its log", () => {
  const job = "https://github.com/cli/cli/actions/runs/43458279745/job/131998132505";
  const pr = parseBranchPr(JSON.stringify({
    number: 7, title: "t", state: "OPEN", isDraft: false, url: "u", reviewDecision: "", baseRefName: "main",
    statusCheckRollup: [
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "integration-tests (macos-latest)", workflowName: "Unit and Integration Tests", detailsUrl: job },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT", name: "CodeRabbit", workflowName: "", detailsUrl: "https://coderabbit.ai/r/1" },
      { __typename: "StatusContext", state: "ERROR", context: "ci/circleci", targetUrl: "https://circleci.com/gh/o/r/1" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "lint", detailsUrl: "x" },
      { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "", name: "build", detailsUrl: "y" },
    ],
  }), "cli/cli");
  assert.deepEqual(pr?.failed, [
    { name: "Unit and Integration Tests / integration-tests (macos-latest)", url: job, log: "gh run view --job 131998132505 --repo cli/cli --log-failed" },
    { name: "CodeRabbit", url: "https://coderabbit.ai/r/1", log: null },
    { name: "ci/circleci", url: "https://circleci.com/gh/o/r/1", log: null },
  ]);
  const forged = parseBranchPr(JSON.stringify({ number: 1, statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE", name: "x", detailsUrl: "https://evil.io/actions/runs/1/job/2; echo pwned" }] }), "o/r");
  assert.equal(forged?.failed[0]?.log, null, "a job id is only ever digits read from a GitHub Actions page");
});

test("GitLab: a failed pipeline names itself until its jobs are read", () => {
  const json = JSON.stringify({ iid: 9, title: "t", state: "opened", head_pipeline: { id: 77, status: "failed", web_url: "https://git.acme.dev/g/app/-/pipelines/77" } });
  assert.deepEqual(parseBranchMr(json)?.failed, [{ name: "Pipeline #77", url: "https://git.acme.dev/g/app/-/pipelines/77", log: null }]);
  assert.equal(pipelineId(json), 77);
  assert.equal(pipelineId(JSON.stringify({ iid: 9, head_pipeline: null })), null);
  assert.equal(pipelineId("[]"), null);
  assert.deepEqual(failedJobsArgs("g/s/app", 77), ["api", "--hostname", "gitlab.com", "projects/g%2Fs%2Fapp/pipelines/77/jobs?scope[]=failed&per_page=100"]);
  assert.deepEqual(failedJobsArgs("https://git.acme.dev/g/app", 77), ["api", "--hostname", "git.acme.dev", "projects/g%2Fapp/pipelines/77/jobs?scope[]=failed&per_page=100"]);
  const jobs = JSON.stringify([
    { id: 501, name: "unit", stage: "test", status: "failed", allow_failure: false, web_url: "https://git.acme.dev/g/app/-/jobs/501" },
    { id: 502, name: "flaky", stage: "test", status: "failed", allow_failure: true, web_url: "w2" },
    { id: "x", name: "bad" },
  ]);
  assert.deepEqual(parseFailedJobs(jobs, "https://git.acme.dev/g/app"), [
    { name: "test / unit", url: "https://git.acme.dev/g/app/-/jobs/501", log: "glab ci trace 501 --repo https://git.acme.dev/g/app" },
  ], "a job allowed to fail didn't fail the pipeline");
  assert.deepEqual(parseFailedJobs("{}", "g/app"), []);
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
  assert.deepEqual(await loadPrs(gitFor("git@github.com:a/b.git"), spy, T, "/home"), { items: [], error: null, repo: "a/b", label: "PR", host: null });
  assert.deepEqual(calls[0]?.[0], "gh");
  assert.deepEqual(calls[0]?.[2], { cwd: "/home", on: null }, "the CLI runs outside the repo");
  assert.equal((await loadPrs(gitFor("https://git.acme.dev/g/app", "gitlab"), spy, T, "/home")).label, "MR");
  assert.equal(calls[1]?.[0], "glab");
});

test("loadPrs reports a missing forge, a failing or missing CLI", async () => {
  const ok: Exec = async () => ({ code: 0, stdout: "[]", stderr: "" });
  const unknown = await loadPrs(gitFor("https://git.acme.dev/g/app"), ok, T, "/home");
  assert.equal(unknown.host, "git.acme.dev", "the person names its forge");
  assert.match(unknown.error ?? "", /git\.acme\.dev/);
  const bad: Exec = async () => ({ code: 1, stdout: "", stderr: "gh auth login required\nmore" });
  assert.equal((await loadPrs(gitFor("https://github.com/a/b"), bad, T, "/home")).error, "gh auth login required");
  const missing: Exec = async () => {
    throw new Error("spawn glab ENOENT");
  };
  assert.match((await loadPrs(gitFor("https://gitlab.com/a/b"), missing, T, "/home")).error ?? "", /Can't run glab/);
  const noRemote: Git = async () => {
    throw new Error("No such remote 'origin'");
  };
  const none = await loadPrs(noRemote, ok, T, "/home");
  assert.match(none.error ?? "", /GitHub or GitLab remote/);
  assert.equal(none.host, null);
});

test("loadBranchPr: none without a forge or a PR/MR, an error when the CLI fails", async () => {
  const none: Exec = async () => ({ code: 1, stdout: "", stderr: 'no pull requests found for branch "x"\n' });
  assert.deepEqual(await loadBranchPr(gitFor("git@github.com:o/r.git"), none, T, "/home", "x"), { pr: null, error: null, label: "PR", host: null, forge: "github" });
  const noMr: Exec = async () => ({ code: 1, stdout: "", stderr: "no open merge request available for \"x\"\n" });
  assert.deepEqual(await loadBranchPr(gitFor("git@gitlab.com:o/r.git"), noMr, T, "/home", "x"), { pr: null, error: null, label: "MR", host: null, forge: "gitlab" });
  const broken: Exec = async () => ({ code: 4, stdout: "", stderr: "gh: To get started, run gh auth login\n" });
  assert.equal((await loadBranchPr(gitFor("git@github.com:o/r.git"), broken, T, "/home", "x")).error, "gh: To get started, run gh auth login");
  const ok: Exec = async () => ({ code: 0, stdout: JSON.stringify({ iid: 3, title: "t", state: "opened", web_url: "w" }), stderr: "" });
  assert.equal((await loadBranchPr(gitFor("git@gitlab.com:o/r.git"), ok, T, "/home", "x")).pr?.number, 3);
  assert.deepEqual(await loadBranchPr(gitFor("https://git.acme.dev/o/r"), ok, T, "/home", "x"), { pr: null, error: null, label: "PR", host: "git.acme.dev", forge: null }, "an unknown host is named, to be told which forge it is");
  assert.equal((await loadBranchPr(gitFor("not a url"), ok, T, "/home", "x")).host, null, "no host without a remote to read");
  assert.equal((await loadBranchPr(gitFor("https://git.acme.dev/o/r", "gitlab"), ok, T, "/home", "x")).host, null, "a named forge isn't asked about");
  assert.deepEqual(await loadBranchPr(gitFor("git@gitlab.com:o/r.git"), ok, T, "/home", null), { pr: null, error: null, label: "MR", host: null, forge: "gitlab" }, "no branch: only the forge");
  const gone: Exec = async () => {
    throw new Error("spawn gh ENOENT");
  };
  assert.match((await loadBranchPr(gitFor("git@github.com:o/r.git"), gone, T, "/home", "x")).error ?? "", /Can't run gh/);
});

test("loadBranchPr reads a failed MR pipeline's jobs, and keeps the pipeline when it can't", async () => {
  const mr = JSON.stringify({ iid: 9, title: "t", state: "opened", head_pipeline: { id: 77, status: "failed", web_url: "pw" } });
  const jobs = JSON.stringify([{ id: 501, name: "unit", stage: "test", status: "failed", web_url: "jw" }]);
  const calls: [string, string[], unknown][] = [];
  const glab = (api: { code: number; stdout: string }): Exec => async (c, a, o) => {
    calls.push([c, a, o]);
    return a[0] === "api" ? { ...api, stderr: "" } : { code: 0, stdout: mr, stderr: "" };
  };
  const read = await loadBranchPr(gitFor("git@gitlab.com:g/app.git"), glab({ code: 0, stdout: jobs }), T, "/home", "x");
  assert.deepEqual(read.pr?.failed, [{ name: "test / unit", url: "jw", log: "glab ci trace 501 --repo g/app" }]);
  assert.deepEqual(calls[1], ["glab", ["api", "--hostname", "gitlab.com", "projects/g%2Fapp/pipelines/77/jobs?scope[]=failed&per_page=100"], { cwd: "/home", on: null }]);
  const kept = await loadBranchPr(gitFor("git@gitlab.com:g/app.git"), glab({ code: 1, stdout: "" }), T, "/home", "x");
  assert.deepEqual(kept.pr?.failed, [{ name: "Pipeline #77", url: "pw", log: null }]);
  const passing = JSON.stringify({ iid: 9, head_pipeline: { id: 78, status: "success" } });
  let asked = 0;
  await loadBranchPr(gitFor("git@gitlab.com:g/app.git"), async (_c, a) => (a[0] === "api" ? (asked++, { code: 0, stdout: "[]", stderr: "" }) : { code: 0, stdout: passing, stderr: "" }), T, "/home", "x");
  assert.equal(asked, 0, "no jobs read for a pipeline that passed");
});

test("an unknown host is read as the forge whose CLI alone is signed in to it", async () => {
  const calls: [string, string[], unknown][] = [];
  const signedIn = (glab: boolean, gh: boolean): Exec => async (c, a, o) => {
    calls.push([c, a, o]);
    if (c === "glab" && a[0] === "config") return { code: 0, stdout: glab ? "secret\n" : "\n", stderr: "" };
    if (c === "gh" && a[0] === "auth") return gh ? { code: 0, stdout: "secret\n", stderr: "" } : { code: 1, stdout: "", stderr: "no token" };
    return { code: 1, stdout: "", stderr: "no open merge request available" };
  };
  const mr = await loadBranchPr(gitFor("https://git.acme.dev/o/r"), signedIn(true, false), T, "/home", "x");
  assert.deepEqual(mr, { pr: null, error: null, label: "MR", host: null, forge: "gitlab" });
  assert.deepEqual(calls.slice(0, 2).map(([c, a]) => [c, a]).sort(), [
    ["gh", ["auth", "token", "--hostname", "git.acme.dev"]],
    ["glab", ["config", "get", "token", "--host", "git.acme.dev"]],
  ]);
  assert.deepEqual(calls[0]?.[2], { cwd: "/home", on: null }, "asked outside the repo");
  assert.deepEqual(calls[2]?.slice(0, 2), ["glab", ["mr", "view", "x", "--repo", "https://git.acme.dev/o/r", "--output", "json"]]);
  assert.equal((await loadPrs(gitFor("https://git.acme.dev/o/r"), signedIn(false, true), T, "/home")).label, "PR", "only gh knows it: GitHub");
  assert.equal((await loadBranchPr(gitFor("https://git.acme.dev/o/r"), signedIn(true, true), T, "/home", "x")).host, "git.acme.dev", "both know it: ask");
  assert.equal((await loadBranchPr(gitFor("https://git.acme.dev/o/r"), signedIn(false, false), T, "/home", "x")).host, "git.acme.dev", "neither: ask");
  const gone: Exec = async () => {
    throw new Error("spawn ENOENT");
  };
  assert.equal((await loadPrs(gitFor("https://git.acme.dev/o/r"), gone, T, "/home")).host, "git.acme.dev", "no CLI: ask");
});

test("a host named as neither forge is never asked about or probed again", async () => {
  const calls: string[] = [];
  const spy: Exec = async (c) => {
    calls.push(c);
    return { code: 0, stdout: "secret\n", stderr: "" };
  };
  assert.deepEqual(await loadBranchPr(gitFor("https://git.acme.dev/o/r", "none"), spy, T, "/home", "x"), { pr: null, error: null, label: "PR", host: null, forge: null });
  assert.equal((await loadPrs(gitFor("https://git.acme.dev/o/r", "none"), spy, T, "/home")).host, null);
  assert.deepEqual(calls, [], "no CLI runs for it");
});

test("setForge names the forge in the repo's own config, and nothing else", async () => {
  const calls: string[][] = [];
  const git: Git = async (_t, args) => {
    calls.push(args);
    return "";
  };
  await setForge(git, T, "gitlab");
  await setForge(git, T, "github");
  await setForge(git, T, "none");
  assert.deepEqual(calls, [
    ["config", "--local", "gitdeck.forge", "gitlab"],
    ["config", "--local", "gitdeck.forge", "github"],
    ["config", "--local", "gitdeck.forge", "none"],
  ]);
});
