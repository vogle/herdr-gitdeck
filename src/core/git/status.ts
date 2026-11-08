// `git status --porcelain=v2`: the branch and every changed path, in one call.

/** Submodules are never entered: each has its own config, which could run programs (see trust.ts). */
export const STATUS_ARGS: readonly string[] = [
  "status",
  "--porcelain=v2",
  "--branch",
  "--show-stash",
  "-z",
  "--untracked-files=normal",
  "--ignore-submodules=all",
];

export type EntryKind = "changed" | "renamed" | "conflict" | "untracked" | "ignored";

export interface StatusEntry {
  kind: EntryKind;
  /** X: the index (staged) side; "." unchanged. */
  index: string;
  /** Y: the work tree (unstaged) side; "." unchanged. */
  worktree: string;
  path: string;
  /** A rename's or copy's source. */
  origPath: string | null;
}

export interface RepoStatus {
  /** HEAD's commit; null before the first commit. */
  oid: string | null;
  /** null when detached. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  stash: number;
  entries: readonly StatusEntry[];
}

export interface StatusSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  clean: boolean;
}

/** The text after the first `count` space-separated fields (paths may hold spaces). */
function afterFields(record: string, count: number): string {
  let at = 0;
  for (let i = 0; i < count; i++) {
    at = record.indexOf(" ", at) + 1;
    if (at === 0) return "";
  }
  return record.slice(at);
}

function entry(kind: EntryKind, xy: string, path: string, origPath: string | null = null): StatusEntry {
  return { kind, index: xy[0] ?? ".", worktree: xy[1] ?? ".", path, origPath };
}

export function parseStatus(output: string): RepoStatus {
  const records = output.split("\0");
  let oid: string | null = null;
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let stash = 0;
  const entries: StatusEntry[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    if (record === "") continue;
    const type = record[0];
    if (type === "#") {
      const [, key = "", ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        ahead = m ? Number(m[1]) : 0;
        behind = m ? Number(m[2]) : 0;
      } else if (key === "stash") stash = Number(value) || 0;
    } else if (type === "1") {
      entries.push(entry("changed", record.slice(2, 4), afterFields(record, 8)));
    } else if (type === "2") {
      // With -z the source path is the next record.
      const origPath = records[i + 1] ?? null;
      i += 1;
      entries.push(entry("renamed", record.slice(2, 4), afterFields(record, 9), origPath));
    } else if (type === "u") {
      entries.push(entry("conflict", record.slice(2, 4), afterFields(record, 10)));
    } else if (type === "?") {
      entries.push(entry("untracked", "??", record.slice(2)));
    } else if (type === "!") {
      entries.push(entry("ignored", "!!", record.slice(2)));
    }
  }
  return { oid, branch, upstream, ahead, behind, stash, entries };
}

export function summarize(status: RepoStatus): StatusSummary {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicts = 0;
  for (const e of status.entries) {
    if (e.kind === "conflict") conflicts += 1;
    else if (e.kind === "untracked") untracked += 1;
    else if (e.kind !== "ignored") {
      if (e.index !== ".") staged += 1;
      if (e.worktree !== ".") unstaged += 1;
    }
  }
  return { staged, unstaged, untracked, conflicts, clean: staged + unstaged + untracked + conflicts === 0 };
}
