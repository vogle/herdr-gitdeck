// The repo's forge (GitHub or GitLab), read through its CLI. The CLI is pointed
// at the project and run outside the repo, so it never reads the work tree or
// the repo's config.

import type { Exec, Git, Target } from "../git/runner.ts";
import { parseBranchPr, parsePrs, prListArgs, prViewArgs } from "./github.ts";
import { mrListArgs, mrViewArgs, parseBranchMr, parseMrs } from "./gitlab.ts";
import { forgeOf, parseRemote } from "./remote.ts";
import type { BranchPr, Forge, PrList } from "./types.ts";

export type { BranchPr, Checks, Forge, PrList, PullRequest } from "./types.ts";

/** The forge of origin; `git config gitdeck.forge github|gitlab` names it for any host. */
export async function readForge(git: Git, target: Target): Promise<Forge | null> {
  const [url, override] = await Promise.all([
    git(target, ["remote", "get-url", "origin"]).catch(() => ""),
    git(target, ["config", "--get", "gitdeck.forge"]).then((v) => v.trim(), () => null),
  ]);
  return forgeOf(parseRemote(url), override);
}

const failure = (cli: string, error: unknown): string => `Can't run ${cli}: ${error instanceof Error ? error.message : String(error)}`;

/** `away` is a folder outside the repo (home) for the CLI to run in. */
export async function loadPrs(git: Git, exec: Exec, target: Target, away: string): Promise<PrList> {
  const forge = await readForge(git, target);
  if (forge === null) return { items: [], error: "No GitHub or GitLab remote: origin isn't one (set gitdeck.forge for your own host)", repo: null, label: "PR" };
  const base = { repo: forge.repo, label: forge.label };
  const args = forge.kind === "github" ? prListArgs(forge.repo) : mrListArgs(forge.repo);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code !== 0) return { ...base, items: [], error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})` };
    return { ...base, items: forge.kind === "github" ? parsePrs(r.stdout) : parseMrs(r.stdout), error: null };
  } catch (error) {
    return { ...base, items: [], error: failure(forge.cli, error) };
  }
}

/** The CLIs' words for "this branch has none". */
const NONE = /no pull requests found|no (?:open )?merge requests? (?:available|found)/i;

/** The branch's PR or MR; none (and no error) without a forge or one to show. */
export async function loadBranchPr(git: Git, exec: Exec, target: Target, away: string, branch: string): Promise<{ pr: BranchPr | null; error: string | null; label: "PR" | "MR" }> {
  const forge = await readForge(git, target);
  if (forge === null) return { pr: null, error: null, label: "PR" };
  const label = forge.label;
  const args = forge.kind === "github" ? prViewArgs(forge.repo, branch) : mrViewArgs(forge.repo, branch);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code === 0) return { pr: forge.kind === "github" ? parseBranchPr(r.stdout) : parseBranchMr(r.stdout), error: null, label };
    if (NONE.test(r.stderr)) return { pr: null, error: null, label };
    return { pr: null, error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})`, label };
  } catch (error) {
    return { pr: null, error: failure(forge.cli, error), label };
  }
}
