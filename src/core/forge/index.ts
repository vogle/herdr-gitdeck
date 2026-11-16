// The repo's forge (GitHub or GitLab), read through its CLI. The CLI is pointed
// at the project and run outside the repo, so it never reads the work tree or
// the repo's config.

import type { Exec, Git, Target } from "../git/runner.ts";
import { parseBranchPr, parsePrs, prListArgs, prViewArgs } from "./github.ts";
import { failedJobsArgs, mrListArgs, mrViewArgs, parseBranchMr, parseFailedJobs, parseMrs, pipelineId } from "./gitlab.ts";
import { forgeOf, parseRemote } from "./remote.ts";
import { discussionsArgs, parseDiscussions, parseThreads, threadsArgs, type ReviewThread } from "./reviewThreads.ts";
import type { BranchPr, Forge, ForgeChoice, ForgeKind, PrList } from "./types.ts";

export type { BranchPr, Checks, Forge, ForgeChoice, ForgeKind, PrList, PullRequest } from "./types.ts";
export type { ReviewThread } from "./reviewThreads.ts";

/** Where to ask the CLIs which hosts they are signed in to: outside the repo. */
interface Probe {
  exec: Exec;
  away: string;
}

/**
 * The forge whose CLI alone is signed in to `host` (the person logged in there
 * themselves, so pointing that CLI at it is safe); null when neither or both are.
 * The token each prints is only checked for being there, never kept.
 */
async function signedInForge(probe: Probe, target: Target, host: string): Promise<ForgeKind | null> {
  const has = (cli: string, args: string[]): Promise<boolean> =>
    probe.exec(cli, args, { cwd: probe.away, on: target.on }).then(
      (r) => r.code === 0 && r.stdout.trim() !== "",
      () => false,
    );
  const [gitlab, github] = await Promise.all([
    has("glab", ["config", "get", "token", "--host", host]),
    has("gh", ["auth", "token", "--hostname", host]),
  ]);
  return gitlab === github ? null : gitlab ? "gitlab" : "github";
}

/**
 * origin's host, and its forge; `git config gitdeck.forge github|gitlab|none` names
 * it for any host. With a probe, an unnamed host is read from the signed-in CLIs.
 * The host comes back only while it's unnamed: the person is asked which it is.
 */
async function readOrigin(git: Git, target: Target, probe?: Probe): Promise<{ forge: Forge | null; host: string | null }> {
  const [url, override] = await Promise.all([
    git(target, ["remote", "get-url", "origin"]).catch(() => ""),
    git(target, ["config", "--get", "gitdeck.forge"]).then((v) => v.trim(), () => null),
  ]);
  const remote = parseRemote(url);
  const forge = forgeOf(remote, override);
  if (forge !== null || remote === null || override !== null || !probe) return { forge, host: forge === null && override === null ? (remote?.host ?? null) : null };
  const kind = await signedInForge(probe, target, remote.host);
  const found = kind === null ? null : forgeOf(remote, kind);
  return { forge: found, host: found === null ? remote.host : null };
}

export async function readForge(git: Git, target: Target): Promise<Forge | null> {
  return (await readOrigin(git, target)).forge;
}

/** Names origin's forge for this repo (its own .git/config), for a host that isn't github.com or gitlab.com; "none" stops the asking. */
export async function setForge(git: Git, target: Target, kind: ForgeChoice): Promise<void> {
  await git(target, ["config", "--local", "gitdeck.forge", kind]);
}

const failure = (cli: string, error: unknown): string => `Can't run ${cli}: ${error instanceof Error ? error.message : String(error)}`;

/** `away` is a folder outside the repo (home) for the CLI to run in. */
export async function loadPrs(git: Git, exec: Exec, target: Target, away: string): Promise<PrList> {
  const { forge, host } = await readOrigin(git, target, { exec, away });
  if (forge === null) {
    const error = host === null ? "No GitHub or GitLab remote: origin isn't one" : `origin is on ${host}: is it GitLab or GitHub?`;
    return { items: [], error, repo: null, label: "PR", host };
  }
  const base = { repo: forge.repo, label: forge.label, host: null };
  const args = forge.kind === "github" ? prListArgs(forge.repo) : mrListArgs(forge.repo);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code !== 0) return { ...base, items: [], error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})` };
    return { ...base, items: forge.kind === "github" ? parsePrs(r.stdout) : parseMrs(r.stdout), error: null };
  } catch (error) {
    return { ...base, items: [], error: failure(forge.cli, error) };
  }
}

/** A failed MR pipeline with its failed jobs in place of itself; as it was when they can't be read. */
async function withFailedJobs(exec: Exec, target: Target, away: string, repo: string, pr: BranchPr, pipeline: number | null): Promise<BranchPr> {
  if (pr.checks.failed === 0 || pipeline === null) return pr;
  try {
    const r = await exec("glab", failedJobsArgs(repo, pipeline), { cwd: away, on: target.on });
    const jobs = r.code === 0 ? parseFailedJobs(r.stdout, repo) : [];
    return jobs.length > 0 ? { ...pr, failed: jobs } : pr;
  } catch {
    return pr;
  }
}

/** The CLIs' words for "this branch has none". */
const NONE = /no pull requests found|no (?:open )?merge requests? (?:available|found)/i;

export interface BranchPrState {
  pr: BranchPr | null;
  error: string | null;
  label: "PR" | "MR";
  /** origin's host when it isn't a known forge yet: the person names which it is. */
  host: string | null;
  /** The forge read, or null when origin isn't one (or isn't named yet). */
  forge: ForgeKind | null;
}

/** The branch's PR or MR; none (and no error) without a forge or one to show. Without a branch, only the forge. */
export async function loadBranchPr(git: Git, exec: Exec, target: Target, away: string, branch: string | null): Promise<BranchPrState> {
  const { forge, host: origin } = await readOrigin(git, target, { exec, away });
  if (forge === null) return { pr: null, error: null, label: "PR", host: origin, forge: null };
  const label = forge.label;
  const host = null;
  const known = { label, host, forge: forge.kind };
  if (branch === null) return { pr: null, error: null, ...known };
  const args = forge.kind === "github" ? prViewArgs(forge.repo, branch) : mrViewArgs(forge.repo, branch);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code === 0) {
      const pr = forge.kind === "github" ? parseBranchPr(r.stdout, forge.repo) : parseBranchMr(r.stdout);
      return { pr: pr && forge.kind === "gitlab" ? await withFailedJobs(exec, target, away, forge.repo, pr, pipelineId(r.stdout)) : pr, error: null, ...known };
    }
    if (NONE.test(r.stderr)) return { pr: null, error: null, ...known };
    return { pr: null, error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})`, ...known };
  } catch (error) {
    return { pr: null, error: failure(forge.cli, error), ...known };
  }
}

/** The open review threads on PR/MR `number`: read once, when the person asks for them. */
export async function loadReviewThreads(git: Git, exec: Exec, target: Target, away: string, number: number): Promise<{ threads: ReviewThread[]; error: string | null }> {
  const { forge } = await readOrigin(git, target);
  if (forge === null) return { threads: [], error: "No GitHub or GitLab remote" };
  const args = forge.kind === "github" ? threadsArgs(forge.repo, number) : discussionsArgs(forge.repo, number);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code !== 0) return { threads: [], error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})` };
    return { threads: forge.kind === "github" ? parseThreads(r.stdout) : parseDiscussions(r.stdout), error: null };
  } catch (error) {
    return { threads: [], error: failure(forge.cli, error) };
  }
}
