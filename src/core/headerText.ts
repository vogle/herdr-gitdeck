// Words for the panel's top: the Changes tab's count, with new files apart from
// changed ones, and conflicts as a warning that says what it is.

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

/** "! 2 conflicts", or null when there are none. */
export function conflictWarning(status: StatusLike | null): string | null {
  const n = count(status, (k) => k === "conflict");
  return n === 0 ? null : `! ${n} conflict${n === 1 ? "" : "s"}`;
}
