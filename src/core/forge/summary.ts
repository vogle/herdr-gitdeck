// How a branch's PR or MR reads in a line: its number, its state, its checks.

import type { BranchPrState } from "./index.ts";
import type { BranchPr, Checks } from "./types.ts";

export function prNumber(pr: BranchPr, label: "PR" | "MR"): string {
  return `${label} ${label === "MR" ? "!" : "#"}${pr.number}`;
}

export function prState(pr: BranchPr): string {
  const review = pr.review === "APPROVED" ? " · approved" : pr.review === "CHANGES_REQUESTED" ? " · changes requested" : "";
  return `${pr.draft ? "DRAFT" : pr.state}${review}`;
}

export function checksText({ passed, failed, pending }: Checks): string {
  if (passed + failed + pending === 0) return "no checks";
  return `checks ${passed}✓${failed > 0 ? ` ${failed}✗` : ""}${pending > 0 ? ` ${pending}…` : ""}`;
}

export function checksTone({ passed, failed, pending }: Checks): "failed" | "pending" | "passed" | "none" {
  if (failed > 0) return "failed";
  if (pending > 0) return "pending";
  return passed > 0 ? "passed" : "none";
}

export type PrRow =
  | { kind: "pr"; pr: BranchPr }
  | { kind: "ask"; host: string }
  | { kind: "reading"; text: string }
  | { kind: "error"; text: string }
  | { kind: "none"; text: string };

/**
 * What the row under the header shows for the branch: its PR, the question of
 * which forge origin is, that it's being read, why it can't be, or why there's
 * none. Always something, so the row keeps its place.
 */
export function prRow(state: BranchPrState | null, branch: string | null, mainLine = false): PrRow {
  if (branch === null) return { kind: "none", text: "Detached HEAD: no branch to have a PR" };
  if (state === null) return { kind: "reading", text: "Checking for a PR or MR…" };
  if (state.host !== null) return { kind: "ask", host: state.host };
  if (state.forge === null) return { kind: "none", text: "No GitHub or GitLab remote: no PRs to show" };
  if (state.pr !== null) return { kind: "pr", pr: state.pr };
  if (state.error !== null) return { kind: "error", text: `Can't read the ${state.label}: ${state.error}` };
  if (mainLine) return { kind: "none", text: `On the main line: ${state.label}s come from other branches` };
  return { kind: "none", text: `No ${state.label} for this branch yet` };
}
