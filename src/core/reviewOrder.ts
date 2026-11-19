// The Review tab's order: what a person reviewing an agent's branch should read
// first. Code, then tests, then the rest (docs, settings, icons, locks); inside
// each group the most changed file comes first.

import { fileKind } from "./fileKind.ts";

export type ReviewGroup = "code" | "tests" | "other";

export const REVIEW_GROUPS: readonly ReviewGroup[] = ["code", "tests", "other"];

const TEST_FOLDER = /(^|\/)(tests?|__tests__|spec)\//;
const TEST_NAME = /([._]test|\.spec)\.[^/.]+$/;

export function reviewGroup(path: string): ReviewGroup {
  if (TEST_FOLDER.test(path) || TEST_NAME.test(path)) return "tests";
  const kind = fileKind(path);
  return kind === "code" || kind === "terminal" ? "code" : "other";
}

interface Sized {
  path: string;
  added: number;
  deleted: number;
}

const bySize = (a: Sized, b: Sized): number => b.added + b.deleted - (a.added + a.deleted) || a.path.localeCompare(b.path);

/** The non-empty groups in reading order, each sorted most changed first. */
export function groupReview<T extends Sized>(files: readonly T[]): { group: ReviewGroup; files: T[] }[] {
  return REVIEW_GROUPS.map((group) => ({ group, files: files.filter((f) => reviewGroup(f.path) === group).sort(bySize) })).filter(
    (g) => g.files.length > 0,
  );
}

/** Every file in the order the groups are read: what next and previous step through. */
export function reviewOrder<T extends Sized>(files: readonly T[]): T[] {
  return groupReview(files).flatMap((g) => g.files);
}
