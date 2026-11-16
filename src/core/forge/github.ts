// GitHub through the gh CLI, read-only: the PR list and the branch's PR.

import { record, seconds, str, type BranchPr, type Checks, type FailedCheck, type PullRequest } from "./types.ts";

export const prListArgs = (repo: string): string[] => [
  "pr", "list", "--repo", repo, "--state", "all", "--limit", "100",
  "--json", "number,title,state,isDraft,headRefName,headRefOid,author,updatedAt",
];

export const prViewArgs = (repo: string, branch: string): string[] => [
  "pr", "view", branch, "--repo", repo, "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup,baseRefName",
];

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
          author: str(record(d.author)?.login),
          updated: seconds(d.updatedAt),
        }],
  );
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

/** A GitHub Actions job page; the job id is all digits, so the command built from it can't carry anything else. */
const JOB = /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+\/job\/(\d+)$/;

function failedCheck(c: Record<string, unknown>, repo: string): FailedCheck {
  const run = c.__typename === "CheckRun";
  const workflow = str(c.workflowName);
  const name = run ? (workflow ? `${workflow} / ${str(c.name)}` : str(c.name)) : str(c.context);
  const url = str(run ? c.detailsUrl : c.targetUrl);
  const job = run && repo !== "" ? JOB.exec(url)?.[1] : undefined;
  return { name, url, log: job ? `gh run view --job ${job} --repo ${repo} --log-failed` : null };
}

/** `repo` (as gh's --repo takes it) goes into each failed check's log command. */
export function parseBranchPr(json: string, repo = ""): BranchPr | null {
  const o = record(JSON.parse(json));
  if (o === null || typeof o.number !== "number") return null;
  const checks: Checks = { passed: 0, failed: 0, pending: 0 };
  const failed: FailedCheck[] = [];
  for (const c of Array.isArray(o.statusCheckRollup) ? o.statusCheckRollup : []) {
    const r = record(c);
    if (!r) continue;
    const v = verdict(r);
    checks[v] += 1;
    if (v === "failed") failed.push(failedCheck(r, repo));
  }
  return { number: o.number, title: str(o.title), state: str(o.state), draft: o.isDraft === true, url: str(o.url), review: str(o.reviewDecision), checks, target: str(o.baseRefName), failed };
}
