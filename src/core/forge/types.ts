// What GitDeck shows from a forge (GitHub or GitLab), in one shape for both.

export type ForgeKind = "github" | "gitlab";

/** What a person names origin's host as: one of the forges, or neither (never asked again). */
export type ForgeChoice = ForgeKind | "none";

export interface Forge {
  kind: ForgeKind;
  /** What the forge calls a review request. */
  label: "PR" | "MR";
  /** The CLI that talks to it. */
  cli: "gh" | "glab";
  /** The project as the CLI's --repo takes it. */
  repo: string;
}

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

export interface PrList {
  items: readonly PullRequest[];
  error: string | null;
  repo: string | null;
  label: "PR" | "MR";
  /** origin's host when it isn't a known forge yet: the person names which it is. */
  host: string | null;
}

export interface Checks {
  passed: number;
  failed: number;
  pending: number;
}

/** The shown branch's PR or MR, for the Review tab. */
export interface BranchPr {
  number: number;
  title: string;
  /** OPEN, CLOSED or MERGED. */
  state: string;
  draft: boolean;
  url: string;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or "". */
  review: string;
  checks: Checks;
  /** The branch it merges into ("" when the forge didn't say). */
  target: string;
}

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const seconds = (iso: unknown): number => Math.floor((Date.parse(str(iso)) || 0) / 1000);
export const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
