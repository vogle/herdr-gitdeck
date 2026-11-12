// Live updates for the shown repo: which folder-watch events are worth a git
// call, how far apart those calls are, and when the agents working here changed.
// Measured on a 50k-file repo, `git status` takes ~230 ms: the watch must not
// turn every saved file (or a `pnpm install`) into a back-to-back stream of them.

import type { RepoAgent } from "./repoAgents.ts";

/** Waits for the burst to settle before reading. */
export const QUIET_MS = 300;
/** Never closer than this, however fast git is. */
export const MIN_GAP_MS = 1_000;
/** A slow repo waits this many times its last read. */
const GAP_FACTOR = 4;

/** What an agent's git leaves under .git: HEAD moved, the index or a ref changed, an operation started. */
const GIT_SIGNALS = /^(?:(?:HEAD|index|packed-refs|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)$|refs\/|rebase-(?:merge|apply)(?:\/|$))/;
/** Folders whose churn never shows in git status (or isn't worth a read). */
const NOISE_DIR = /(^|\/)node_modules(\/|$)/;

/** Any path in the batch that can change what the panel shows. */
export function relevantChange(root: string, paths: readonly string[]): boolean {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return paths.some((path) => {
    if (path === base || path === `${base}/`) return true;
    if (!path.startsWith(`${base}/`)) return false;
    const rel = path.slice(base.length + 1);
    if (rel === ".git" || rel.startsWith(".git/")) return GIT_SIGNALS.test(rel.slice(5));
    return !NOISE_DIR.test(rel);
  });
}

/** Milliseconds to keep between two live reads, given the last one's duration. */
export function liveGap(lastMs: number): number {
  return Number.isFinite(lastMs) ? Math.max(MIN_GAP_MS, Math.round(lastMs * GAP_FACTOR)) : MIN_GAP_MS;
}

/** Equal for the same agents in the same states, in any order. */
export function agentsKey(agents: readonly RepoAgent[]): string {
  return agents
    .map((a) => `${a.key}:${a.name}:${a.status}`)
    .sort()
    .join("|");
}
