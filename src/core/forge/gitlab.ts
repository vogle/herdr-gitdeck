// GitLab through the glab CLI, read-only: the MR list and the branch's MR.

import { record, seconds, str, type BranchPr, type Checks, type PullRequest } from "./types.ts";

export const mrListArgs = (repo: string): string[] => ["mr", "list", "--repo", repo, "--all", "--per-page", "100", "--output", "json"];

export const mrViewArgs = (repo: string, branch: string): string[] => ["mr", "view", branch, "--repo", repo, "--output", "json"];

/** GitLab's opened/closed/merged as GitHub's OPEN/CLOSED/MERGED. */
const STATE: Record<string, string> = { opened: "OPEN", closed: "CLOSED", merged: "MERGED", locked: "CLOSED" };
const state = (v: unknown): string => STATE[str(v)] ?? str(v).toUpperCase();

export function parseMrs(json: string): PullRequest[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  return data.flatMap((d: Record<string, unknown>): PullRequest[] =>
    typeof d?.iid !== "number"
      ? []
      : [{
          number: d.iid,
          title: str(d.title),
          state: state(d.state),
          draft: d.draft === true,
          branch: str(d.source_branch),
          head: str(d.sha),
          author: str(record(d.author)?.username),
          updated: seconds(d.updated_at),
        }],
  );
}

const PIPELINE_WAIT = new Set(["created", "waiting_for_resource", "preparing", "pending", "running", "scheduled", "manual"]);

/** The head pipeline is GitLab's one check. */
function pipelineChecks(pipeline: unknown): Checks {
  const status = str(record(pipeline)?.status);
  if (status === "") return { passed: 0, failed: 0, pending: 0 };
  if (status === "success" || status === "skipped") return { passed: 1, failed: 0, pending: 0 };
  return PIPELINE_WAIT.has(status) ? { passed: 0, failed: 0, pending: 1 } : { passed: 0, failed: 1, pending: 0 };
}

export function parseBranchMr(json: string): BranchPr | null {
  const o = record(JSON.parse(json));
  if (o === null || typeof o.iid !== "number") return null;
  return {
    number: o.iid,
    title: str(o.title),
    state: state(o.state),
    draft: o.draft === true,
    url: str(o.web_url),
    review: o.approved === true ? "APPROVED" : "",
    checks: pipelineChecks(o.head_pipeline),
  };
}
