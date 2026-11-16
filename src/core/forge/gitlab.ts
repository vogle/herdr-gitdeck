// GitLab through the glab CLI, read-only: the MR list and the branch's MR.

import { record, seconds, str, type BranchPr, type Checks, type FailedCheck, type PullRequest } from "./types.ts";

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

/** Until its jobs are read, a failed pipeline is the one failed check. */
function pipelineFailed(pipeline: unknown, checks: Checks): FailedCheck[] {
  const p = record(pipeline);
  if (checks.failed === 0 || p === null) return [];
  return [{ name: typeof p.id === "number" ? `Pipeline #${p.id}` : "Pipeline", url: str(p.web_url), log: null }];
}

export function parseBranchMr(json: string): BranchPr | null {
  const o = record(JSON.parse(json));
  if (o === null || typeof o.iid !== "number") return null;
  const checks = pipelineChecks(o.head_pipeline);
  return {
    number: o.iid,
    title: str(o.title),
    state: state(o.state),
    draft: o.draft === true,
    url: str(o.web_url),
    review: o.approved === true ? "APPROVED" : "",
    checks,
    target: str(o.target_branch),
    failed: pipelineFailed(o.head_pipeline, checks),
  };
}

/** The MR's head pipeline id, to read its failed jobs. */
export function pipelineId(json: string): number | null {
  const id = record(record(JSON.parse(json))?.head_pipeline)?.id;
  return typeof id === "number" ? id : null;
}

/** The project as glab's --repo takes it ("g/app" on gitlab.com, else a full URL) as a host and a path. */
function hostAndPath(repo: string): { host: string; path: string } {
  const m = /^https:\/\/([^/]+)\/(.+)$/.exec(repo);
  return m?.[1] && m[2] ? { host: m[1], path: m[2] } : { host: "gitlab.com", path: repo };
}

/** `glab api` for a pipeline's failed jobs: glab has no command that lists them as JSON for a named project. */
export function failedJobsArgs(repo: string, pipeline: number): string[] {
  const { host, path } = hostAndPath(repo);
  return ["api", "--hostname", host, `projects/${encodeURIComponent(path)}/pipelines/${pipeline}/jobs?scope[]=failed&per_page=100`];
}

/** The jobs that failed the pipeline (not those allowed to fail), each with the command for its log. */
export function parseFailedJobs(json: string, repo: string): FailedCheck[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  return data.flatMap((d): FailedCheck[] => {
    const j = record(d);
    if (j === null || typeof j.id !== "number" || j.status !== "failed" || j.allow_failure === true) return [];
    const stage = str(j.stage);
    return [{ name: stage ? `${stage} / ${str(j.name)}` : str(j.name), url: str(j.web_url), log: `glab ci trace ${j.id} --repo ${repo}` }];
  });
}
