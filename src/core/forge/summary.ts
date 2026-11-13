// How a branch's PR or MR reads in a line: its number, its state, its checks.

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
