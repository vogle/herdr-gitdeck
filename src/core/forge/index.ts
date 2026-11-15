// The repo's forge (GitHub or GitLab), read through its CLI. The CLI is pointed
// at the project and run outside the repo, so it never reads the work tree or
// the repo's config.

import type { Exec, Git, Target } from "../git/runner.ts";
import { parseBranchPr, parsePrs, prListArgs, prViewArgs } from "./github.ts";
import { mrListArgs, mrViewArgs, parseBranchMr, parseMrs } from "./gitlab.ts";
import { forgeOf, parseRemote } from "./remote.ts";
import type { BranchPr, Forge, ForgeKind, PrList } from "./types.ts";

export type { BranchPr, Checks, Forge, ForgeKind, PrList, PullRequest } from "./types.ts";

/** origin's host, and its forge; `git config gitdeck.forge github|gitlab` names it for any host. */
async function readOrigin(git: Git, target: Target): Promise<{ forge: Forge | null; host: string | null }> {
  const [url, override] = await Promise.all([
    git(target, ["remote", "get-url", "origin"]).catch(() => ""),
    git(target, ["config", "--get", "gitdeck.forge"]).then((v) => v.trim(), () => null),
  ]);
  const remote = parseRemote(url);
  return { forge: forgeOf(remote, override), host: remote?.host ?? null };
}

export async function readForge(git: Git, target: Target): Promise<Forge | null> {
  return (await readOrigin(git, target)).forge;
}

/** Names origin's forge for this repo (its own .git/config), for a host that isn't github.com or gitlab.com. */
export async function setForge(git: Git, target: Target, kind: ForgeKind): Promise<void> {
  await git(target, ["config", "--local", "gitdeck.forge", kind]);
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

export interface BranchPrState {
  pr: BranchPr | null;
  error: string | null;
  label: "PR" | "MR";
  /** origin's host when it isn't a known forge yet: the person names which it is. */
  host: string | null;
}

/** The branch's PR or MR; none (and no error) without a forge or one to show. */
export async function loadBranchPr(git: Git, exec: Exec, target: Target, away: string, branch: string): Promise<BranchPrState> {
  const { forge, host: origin } = await readOrigin(git, target);
  if (forge === null) return { pr: null, error: null, label: "PR", host: origin };
  const label = forge.label;
  const host = null;
  const args = forge.kind === "github" ? prViewArgs(forge.repo, branch) : mrViewArgs(forge.repo, branch);
  try {
    const r = await exec(forge.cli, args, { cwd: away, on: target.on });
    if (r.code === 0) return { pr: forge.kind === "github" ? parseBranchPr(r.stdout) : parseBranchMr(r.stdout), error: null, label, host };
    if (NONE.test(r.stderr)) return { pr: null, error: null, label, host };
    return { pr: null, error: r.stderr.split("\n")[0] || `${forge.cli} failed (${r.code})`, label, host };
  } catch (error) {
    return { pr: null, error: failure(forge.cli, error), label, host };
  }
}
