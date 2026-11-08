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
