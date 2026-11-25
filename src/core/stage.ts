// Staging and committing: the commands, and the patch that stages part of a file.

import { SAFE_DIFF } from "./git/show.ts";
import type { DiffRow } from "./git/diff.ts";

export const stageArgs = (paths: readonly string[]): string[] => ["add", "--", ...paths];

/** Before the first commit there is no HEAD to restore the index from. */
export const unstageArgs = (paths: readonly string[], hasHead: boolean): string[] =>
  hasHead ? ["restore", "--staged", "--", ...paths] : ["rm", "--cached", "-q", "--", ...paths];

/** Throws away work-tree changes to tracked files. Cannot be undone. */
export const discardArgs = (paths: readonly string[]): string[] => ["restore", "--worktree", "--", ...paths];

/** Deletes untracked files. Cannot be undone. */
export const cleanArgs = (paths: readonly string[]): string[] => ["clean", "-f", "-q", "--", ...paths];

/** A wholly untracked folder and everything in it (ignored files stay: no -x). */
export const cleanFolderArgs = (folder: string): string[] => ["clean", "-f", "-d", "-q", "--", folder];

export const commitArgs = (message: string, amend: boolean): string[] => ["commit", "-q", ...(amend ? ["--amend"] : []), "-m", message];

export const lastMessageArgs = (): string[] => ["log", "-1", "--no-show-signature", "--format=%B"];

/** What staging would add: the index against the work tree. */
export const unstagedDiffArgs = (path: string): string[] => ["diff", ...SAFE_DIFF, "--", path];

/** What is staged: HEAD against the index. */
export const stagedDiffArgs = (path: string): string[] => ["diff", ...SAFE_DIFF, "--cached", "--", path];

/** `git apply` reads the patch from a file: Herdr's exec has no stdin. */
export const applyArgs = (patchFile: string, reverse: boolean): string[] =>
  ["apply", "--cached", "--recount", "--whitespace=nowarn", ...(reverse ? ["--reverse"] : []), patchFile];

export interface LineRef {
  hunk: number;
  /** The line inside the hunk; -1 for the hunk's header. */
  line: number;
}

/** Which hunk, and which line in it, a diff row is. */
export function lineRef(rows: readonly DiffRow[], index: number): LineRef | null {
  let hunk = -1;
  let line = -1;
  for (let i = 0; i <= index && i < rows.length; i++) {
    if (rows[i]?.kind === "hunk") {
      hunk += 1;
      line = -1;
    } else if (hunk >= 0) line += 1;
  }
  return index < rows.length && hunk >= 0 ? { hunk, line } : null;
}

export interface Pick {
  hunk: number;
  /** Lines inside the hunk; null for all of it. */
  lines: ReadonlySet<number> | null;
}

interface Hunk {
  header: string;
  body: string[];
}

function split(raw: string): { header: string[]; hunks: Hunk[] } {
  const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
  const header: string[] = [];
  const hunks: Hunk[] = [];
  for (const line of lines) {
    if (line.startsWith("@@")) hunks.push({ header: line, body: [] });
    else if (hunks.length > 0) hunks.at(-1)?.body.push(line);
    else header.push(line);
  }
  return { header, hunks };
}

/**
 * One hunk with only the picked lines changed. Applied forward (staging), an
 * unpicked removal stays as context and an unpicked addition goes; applied in
 * reverse (unstaging), the other way round.
 */
function pickLines(hunk: Hunk, lines: ReadonlySet<number> | null, reverse: boolean): string | null {
  const body: string[] = [];
  let kept = false;
  let old = 0;
  let added = 0;
  let changed = false;
  hunk.body.forEach((line, i) => {
    const mark = line.charAt(0);
    const picked = lines === null || lines.has(i);
    if (mark === "\\") {
      if (kept) body.push(line);
      return;
    }
    const asContext = (mark === "-" && !reverse) || (mark === "+" && reverse);
    const next = mark === " " || picked ? line : asContext ? ` ${line.slice(1)}` : null;
    kept = next !== null;
    if (next === null) return;
    body.push(next);
    const m = next.charAt(0);
    if (m !== "+") old += 1;
    if (m !== "-") added += 1;
    if (m !== " ") changed = true;
  });
  if (!changed) return null;
  const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(hunk.header);
  const header = head ? `@@ -${head[1]},${old} +${head[2]},${added} @@${head[3]}` : hunk.header;
  return [header, ...body].join("\n");
}

/** A patch of one file's diff with only the picked hunks and lines, or null when it changes nothing. */
export function buildPatch(raw: string, picks: readonly Pick[], reverse: boolean): string | null {
  const { header, hunks } = split(raw);
  const parts = [...picks]
    .sort((a, b) => a.hunk - b.hunk)
    .flatMap((p) => {
      const hunk = hunks[p.hunk];
      const part = hunk ? pickLines(hunk, p.lines, reverse) : null;
      return part === null ? [] : [part];
    });
  if (parts.length === 0) return null;
  return `${[...header, ...parts].join("\n")}\n`;
}

/** Recent commit messages, newest first, each once. */
export function remember(messages: readonly string[], message: string, max = 20): string[] {
  const m = message.trim();
  if (m === "") return [...messages];
  return [m, ...messages.filter((x) => x !== m)].slice(0, max);
}
