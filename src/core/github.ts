// GitHub (M5), read-only: the repo's pull requests through the gh CLI.
// gh is pointed at owner/repo and run outside the repo, so it never reads the
// work tree or the repo's config.

import type { Exec, Git, Target } from "./git/runner.ts";

const PART = "[A-Za-z0-9_.][A-Za-z0-9_.-]*";
const URLS = [
  new RegExp(`^https://github\\.com/(${PART})/(${PART}?)(?:\\.git)?/?$`),
  new RegExp(`^(?:ssh://)?git@github\\.com[:/](${PART})/(${PART}?)(?:\\.git)?$`),
];

/** owner/repo of a github.com remote URL, else null. */
export function githubRepo(url: string): string | null {
  for (const re of URLS) {
    const m = re.exec(url.trim());
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

export const prListArgs = (repo: string): string[] => [
  "pr", "list", "--repo", repo, "--state", "all", "--limit", "100",
  "--json", "number,title,state,isDraft,headRefName,headRefOid,author,updatedAt",
];

export interface PullRequest {
  number: number;
  title: string;
  /** OPEN, CLOSED or MERGED. */
  state: string;
  draft: boolean;
  branch: string;
  /** The head commit: a click jumps to it when it's in the graph. */
  head: string;
  author: string;
  updated: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function parsePrs(json: string): PullRequest[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  return data.flatMap((d: Record<string, unknown>): PullRequest[] =>
    typeof d?.number !== "number"
      ? []
      : [{
          number: d.number,
          title: str(d.title),
          state: str(d.state),
          draft: d.isDraft === true,
          branch: str(d.headRefName),
          head: str(d.headRefOid),
          author: str((d.author as Record<string, unknown> | undefined)?.login),
          updated: Math.floor((Date.parse(str(d.updatedAt)) || 0) / 1000),
        }],
  );
}

export interface PrList {
  items: readonly PullRequest[];
  error: string | null;
  repo: string | null;
}

/** `away` is a folder outside the repo (home) for gh to run in. */
export async function loadPrs(git: Git, exec: Exec, target: Target, away: string): Promise<PrList> {
  const url = await git(target, ["remote", "get-url", "origin"]).catch(() => "");
  const repo = githubRepo(url);
  if (repo === null) return { items: [], error: "No GitHub remote: origin isn't a github.com URL", repo: null };
  try {
    const r = await exec("gh", prListArgs(repo), { cwd: away, on: target.on });
    if (r.code !== 0) return { items: [], error: r.stderr.split("\n")[0] || `gh failed (${r.code})`, repo };
    return { items: parsePrs(r.stdout), error: null, repo };
  } catch (error) {
    return { items: [], error: `Can't run gh (GitHub CLI): ${error instanceof Error ? error.message : String(error)}`, repo };
  }
}

export const prViewArgs = (repo: string, branch: string): string[] => [
  "pr", "view", branch, "--repo", repo, "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup",
];

export interface Checks {
  passed: number;
  failed: number;
  pending: number;
}

/** The shown branch's pull request, for the Review tab. */
export interface BranchPr {
  number: number;
  title: string;
  /** OPEN, CLOSED or MERGED. */
  state: string;
  draft: boolean;
  url: string;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or "". */
  review: string;
  checks: Checks;
}

const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const WAIT = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

/** A check run (status + conclusion) or a commit status (state), as one verdict. */
function verdict(c: Record<string, unknown>): keyof Checks {
  const done = c.__typename !== "CheckRun" || c.status === "COMPLETED";
  const result = str(c.__typename === "CheckRun" ? c.conclusion : c.state);
  if (!done || WAIT.has(result)) return "pending";
  return PASS.has(result) ? "passed" : "failed";
}

export function parseBranchPr(json: string): BranchPr | null {
  const d: unknown = JSON.parse(json);
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (typeof o.number !== "number") return null;
  const checks: Checks = { passed: 0, failed: 0, pending: 0 };
  for (const c of Array.isArray(o.statusCheckRollup) ? o.statusCheckRollup : []) {
    if (typeof c === "object" && c !== null) checks[verdict(c as Record<string, unknown>)] += 1;
  }
  return { number: o.number, title: str(o.title), state: str(o.state), draft: o.isDraft === true, url: str(o.url), review: str(o.reviewDecision), checks };
}

/** The branch's PR; none (and no error) without a GitHub remote or a PR. */
export async function loadBranchPr(git: Git, exec: Exec, target: Target, away: string, branch: string): Promise<{ pr: BranchPr | null; error: string | null }> {
  const repo = githubRepo(await git(target, ["remote", "get-url", "origin"]).catch(() => ""));
  if (repo === null) return { pr: null, error: null };
  try {
    const r = await exec("gh", prViewArgs(repo, branch), { cwd: away, on: target.on });
    if (r.code === 0) return { pr: parseBranchPr(r.stdout), error: null };
    if (/no pull requests found/i.test(r.stderr)) return { pr: null, error: null };
    return { pr: null, error: r.stderr.split("\n")[0] || `gh failed (${r.code})` };
  } catch (error) {
    return { pr: null, error: `Can't run gh (GitHub CLI): ${error instanceof Error ? error.message : String(error)}` };
  }
}
