// A unified diff as rows the diff view can draw, with line numbers.

import type { ImagePair } from "../imageDiff.ts";

export type DiffKind = "hunk" | "ctx" | "add" | "del" | "note";

export interface DiffRow {
  kind: DiffKind;
  old: number | null;
  new: number | null;
  text: string;
}

export interface Diff {
  rows: readonly DiffRow[];
  /** More rows than the cap: the rest were dropped. */
  truncated: boolean;
  /** A changed image's two versions, drawn above the (binary) diff. */
  images?: ImagePair | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const note = (text: string): DiffRow => ({ kind: "note", old: null, new: null, text });

export const DIFF_ROW_CAP = 20000;

/** One line inside a hunk, given the next old and new line numbers. */
function bodyRow(line: string, at: { old: number; new: number }): DiffRow | null {
  const mark = line.charAt(0);
  const text = line.slice(1);
  if (mark === " ") return { kind: "ctx", old: at.old++, new: at.new++, text };
  if (mark === "-") return { kind: "del", old: at.old++, new: null, text };
  if (mark === "+") return { kind: "add", old: null, new: at.new++, text };
  if (mark === "\\") return note(line.slice(2));
  return null;
}

export function parseDiff(output: string, cap = DIFF_ROW_CAP): Diff {
  const rows: DiffRow[] = [];
  const at = { old: 0, new: 0 };
  let inHunk = false;
  for (const line of output.split("\n")) {
    if (rows.length >= cap) return { rows, truncated: true };
    if (line.startsWith("diff --git ")) inHunk = false;
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      at.old = Number(hunk[1]);
      at.new = Number(hunk[2]);
      rows.push({ kind: "hunk", old: null, new: null, text: line });
    } else if (!inHunk) {
      if (line.startsWith("Binary files ")) rows.push(note("Binary file changed"));
    } else if (line !== "") {
      const row = bodyRow(line, at);
      if (row) rows.push(row);
    }
  }
  return { rows: rows.length > 0 ? rows : [note("No text changes")], truncated: false };
}

/** Two reads of a diff show the same thing (images aside: only uncommitted diffs are re-read, and they have none). */
export function sameDiff(a: Diff, b: Diff): boolean {
  if (a.truncated !== b.truncated || a.rows.length !== b.rows.length) return false;
  return a.rows.every((r, i) => {
    const o = b.rows[i];
    return o !== undefined && r.kind === o.kind && r.old === o.old && r.new === o.new && r.text === o.text;
  });
}
