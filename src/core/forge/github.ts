// GitHub through the gh CLI, read-only: the PR list and the branch's PR.

import { record, seconds, str, type BranchPr, type Checks, type PullRequest } from "./types.ts";

export const prListArgs = (repo: string): string[] => [
  "pr", "list", "--repo", repo, "--state", "all", "--limit", "100",
  "--json", "number,title,state,isDraft,headRefName,headRefOid,author,updatedAt",
];

export const prViewArgs = (repo: string, branch: string): string[] => [
  "pr", "view", branch, "--repo", repo, "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup",
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

export function parseBranchPr(json: string): BranchPr | null {
  const o = record(JSON.parse(json));
  if (o === null || typeof o.number !== "number") return null;
  const checks: Checks = { passed: 0, failed: 0, pending: 0 };
  for (const c of Array.isArray(o.statusCheckRollup) ? o.statusCheckRollup : []) {
    const r = record(c);
    if (r) checks[verdict(r)] += 1;
  }
  return { number: o.number, title: str(o.title), state: str(o.state), draft: o.isDraft === true, url: str(o.url), review: str(o.reviewDecision), checks };
}
