// Looking closer (M4): blame, a file's history, the reflog, and taking one
// side of a conflict.

import { logArgs, parseLog, type Commit } from "./git/log.ts";
import type { Git, Target } from "./git/runner.ts";
import type { BlobView, TreeFile } from "./tree.ts";

/** A commit's version of the file: the work-tree one would run clean filters. */
export const blameArgs = (rev: string, path: string): string[] =>
  ["blame", "--porcelain", "--no-textconv", "--no-progress", rev, "--", path];

export interface BlameLine {
  hash: string;
  /** The line's number in this version. */
  line: number;
  text: string;
  author: string;
  time: number;
  summary: string;
  /** The first line of a run from the same commit. */
  first: boolean;
}

interface CommitInfo {
  author: string;
  time: number;
  summary: string;
}

const HEADER = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/;

/** `--porcelain` names a commit's details once, at its first line. */
export function parseBlame(output: string): BlameLine[] {
  const info = new Map<string, CommitInfo>();
  const lines: BlameLine[] = [];
  let hash = "";
  let line = 0;
  for (const raw of output.split("\n")) {
    const header = HEADER.exec(raw);
    if (header) {
      hash = header[1] ?? "";
      line = Number(header[2]);
      if (!info.has(hash)) info.set(hash, { author: "", time: 0, summary: "" });
      continue;
    }
    const current = info.get(hash);
    if (!current) continue;
    if (raw.startsWith("\t")) {
      const prev = lines.at(-1);
      lines.push({ hash, line, text: raw.slice(1), ...current, first: prev?.hash !== hash });
    } else if (raw.startsWith("author ")) current.author = raw.slice(7);
    else if (raw.startsWith("author-time ")) current.time = Number(raw.slice(12)) || 0;
    else if (raw.startsWith("summary ")) current.summary = raw.slice(8);
  }
  return lines;
}

/** The commits that changed a file, following its renames, from `rev` back. */
export function fileLogArgs(rev: string, path: string, limit: number): string[] {
  const format = logArgs(limit).find((a) => a.startsWith("--format=")) ?? "";
  return ["log", "--no-show-signature", "--follow", format, `--max-count=${limit}`, rev, "--", path];
}

export interface ReflogEntry {
  hash: string;
  /** HEAD@{0} */
  name: string;
  /** What moved HEAD: "commit: …", "checkout: moving from …". */
  action: string;
  time: number;
}

export const reflogArgs = (limit: number): string[] =>
  ["log", "-g", "--no-show-signature", "--format=%H%x1f%gd%x1f%gs%x1f%ct%x1e", `--max-count=${limit}`, "HEAD", "--"];

export function parseReflog(output: string): ReflogEntry[] {
  return output
    .split("\x1e")
    .map((r) => r.replace(/^\n/, "").split("\x1f"))
    .filter(([hash = ""]) => /^[0-9a-f]{7,64}$/.test(hash))
    .map(([hash = "", name = "", action = "", time = ""]) => ({ hash, name, action, time: Number(time) || 0 }));
}

/** Take our version (the branch you're on) or theirs (the one coming in). */
export const takeSideArgs = (side: "ours" | "theirs", paths: readonly string[]): string[] =>
  ["checkout", `--${side}`, "--", ...paths];

export interface Loaded<T> {
  items: readonly T[];
  error: string | null;
}

async function load<T>(git: Git, target: Target, args: string[], parse: (out: string) => T[]): Promise<Loaded<T>> {
  try {
    return { items: parse(await git(target, args)), error: null };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export const MAX_INSPECT = 300;

export const loadBlame = (git: Git, target: Target, rev: string, path: string): Promise<Loaded<BlameLine>> =>
  load(git, target, blameArgs(rev, path), parseBlame);
export const loadFileLog = (git: Git, target: Target, rev: string, path: string): Promise<Loaded<Commit>> =>
  load(git, target, fileLogArgs(rev, path, MAX_INSPECT), parseLog);
export const loadReflog = (git: Git, target: Target): Promise<Loaded<ReflogEntry>> =>
  load(git, target, reflogArgs(MAX_INSPECT), parseReflog);

/** What the inspect pane shows; `data` is null while it loads. */
export type InspectView =
  | { kind: "blame"; path: string; rev: string; data: Loaded<BlameLine> | null }
  | { kind: "file-log"; path: string; rev: string; data: Loaded<Commit> | null }
  | { kind: "reflog"; data: Loaded<ReflogEntry> | null }
  | { kind: "tree"; rev: string; data: Loaded<TreeFile> | null; file: TreeFile | null; blob: BlobView | null };
