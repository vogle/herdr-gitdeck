// Resolving a conflicted file block by block (M4): each conflict keeps ours,
// theirs or both, and the rest of the file stays as it is.

import type { Git, Target } from "./git/runner.ts";
import { stageFiles, type Files } from "./staging.ts";

export type Choice = "ours" | "theirs" | "both";

export type Segment =
  | { kind: "text"; lines: readonly string[] }
  | { kind: "conflict"; ours: readonly string[]; theirs: readonly string[]; oursLabel: string; theirsLabel: string; choice: Choice | null };

const OPEN = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const SPLIT = /^={7}$/;
const CLOSE = /^>{7}(?: (.*))?$/;

/** Unclosed markers are left as text: only a whole block counts as a conflict. */
export function parseConflicts(text: string): Segment[] {
  const lines = text.split("\n");
  const out: Segment[] = [];
  let plain: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = OPEN.exec(lines[i] ?? "");
    const block = open ? readBlock(lines, i, open[1] ?? "") : null;
    if (!block) {
      plain.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    if (plain.length > 0) out.push({ kind: "text", lines: plain });
    plain = [];
    out.push(block.segment);
    i = block.next;
  }
  if (plain.length > 0) out.push({ kind: "text", lines: plain });
  return out;
}

function readBlock(lines: readonly string[], start: number, oursLabel: string): { segment: Segment; next: number } | null {
  const ours: string[] = [];
  const theirs: string[] = [];
  let part: "ours" | "base" | "theirs" = "ours";
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const close = part === "theirs" ? CLOSE.exec(line) : null;
    if (close) return { segment: { kind: "conflict", ours, theirs, oursLabel, theirsLabel: close[1] ?? "", choice: null }, next: i + 1 };
    if (part !== "theirs" && SPLIT.test(line)) part = "theirs";
    else if (part === "ours" && BASE.test(line)) part = "base";
    else if (part === "ours") ours.push(line);
    else if (part === "theirs") theirs.push(line);
  }
  return null;
}

export const conflictCount = (segs: readonly Segment[]): number => segs.filter((s) => s.kind === "conflict").length;

/** Sets the choice of the `index`th conflict. */
export function choose(segs: readonly Segment[], index: number, choice: Choice): Segment[] {
  let n = -1;
  return segs.map((s) => (s.kind === "conflict" && ++n === index ? { ...s, choice } : s));
}

export const allChosen = (segs: readonly Segment[]): boolean => segs.every((s) => s.kind !== "conflict" || s.choice !== null);

function linesOf(s: Segment): readonly string[] {
  if (s.kind === "text") return s.lines;
  if (s.choice === "ours") return s.ours;
  if (s.choice === "theirs") return s.theirs;
  return [...s.ours, ...s.theirs];
}

export const resolveText = (segs: readonly Segment[]): string => segs.flatMap(linesOf).join("\n");

/** Writes the resolved file (only if it still reads as `original`), then stages it. */
export async function resolveFile(git: Git, files: Files, target: Target, path: string, original: string, segs: readonly Segment[]): Promise<string | null> {
  if (target.on !== null) return "Resolving by block works only for repos on this machine";
  if (!allChosen(segs)) return "Choose a side for every conflict first";
  try {
    await files.write(`${target.cwd}/${path}`, resolveText(segs), original);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return stageFiles(git, target, [path]);
}
