// Words for the panel's top: the Changes tab's count, with new files apart from
// changed ones, and conflicts as a warning that says what it is.

import type { Compare } from "./review.ts";

interface StatusLike {
  entries: readonly { kind: string }[];
}

const count = (s: StatusLike | null, keep: (kind: string) => boolean): number => s?.entries.filter((e) => keep(e.kind)).length ?? 0;

/** "Changes 5 · 405 new": changed files first, then files git doesn't know yet. */
export function changesTabLabel(status: StatusLike | null): string {
  const fresh = count(status, (k) => k === "untracked");
  const changed = count(status, (k) => k !== "untracked" && k !== "ignored");
  const parts = [changed > 0 ? String(changed) : "", fresh > 0 ? `${fresh} new` : ""].filter((p) => p !== "");
  return parts.length === 0 ? "Changes" : `Changes ${parts.join(" · ")}`;
}

/** Review lists commits only: say so when the work tree holds more (an agent's edits not yet committed). */
export function uncommittedNote(status: StatusLike | null): string | null {
  const n = count(status, (k) => k !== "ignored");
  return n === 0 ? null : `${n} file${n === 1 ? "" : "s"} not committed yet: not in this review`;
}

/** "! 2 conflicts", or null when there are none. */
export function conflictWarning(status: StatusLike | null): string | null {
  const n = count(status, (k) => k === "conflict");
  return n === 0 ? null : `! ${n} conflict${n === 1 ? "" : "s"}`;
}

/** Commits behind the base from which a branch is told to catch up. */
export const FAR_BEHIND = 20;

/**
 * Review diffs from where the branch split, so a moved base doesn't show there;
 * it shows when the branch lands, as conflicts. Null while it's close enough.
 */
export function behindNote(c: Compare | null): string | null {
  if (c === null || c.behind < FAR_BEHIND) return null;
  return `${c.base.replace(/^origin\//, "")} has ${c.behind} commits this branch doesn't: merge or rebase before it lands, or it may conflict`;
}
