// The files at a commit (M4): the tree, and one file's content, both read
// from git's objects (never the work tree, so no filter can run).

import type { Git, Target } from "./git/runner.ts";

export const treeArgs = (rev: string): string[] => ["ls-tree", "-r", "-z", "--long", rev];

export interface TreeFile {
  path: string;
  size: number;
  kind: "file" | "link" | "submodule";
}

export function parseTree(output: string): TreeFile[] {
  return output
    .split("\0")
    .map((record) => {
      const tab = record.indexOf("\t");
      if (tab < 0) return null;
      const [mode = "", type = "", , size = ""] = record.slice(0, tab).split(/\s+/);
      const kind = type === "commit" ? "submodule" : mode === "120000" ? "link" : "file";
      return { path: record.slice(tab + 1), size: Number(size) || 0, kind } as TreeFile;
    })
    .filter((f): f is TreeFile => f !== null);
}

/** `cat-file blob` prints the stored bytes: no textconv, no smudge filter. */
export const blobArgs = (rev: string, path: string): string[] => ["cat-file", "blob", `${rev}:${path}`];

export const MAX_BLOB = 1_000_000;

export interface BlobView {
  lines: readonly string[];
  /** Why there are no lines to show. */
  note: string | null;
}

export function blobText(text: string, size: number): BlobView {
  if (size > MAX_BLOB) return { lines: [], note: `Too big to show (${size} bytes)` };
  if (text.includes("\0")) return { lines: [], note: `Binary file (${size} bytes)` };
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return { lines, note: null };
}

export async function loadTree(git: Git, target: Target, rev: string): Promise<{ files: readonly TreeFile[]; error: string | null }> {
  try {
    return { files: parseTree(await git(target, treeArgs(rev))), error: null };
  } catch (error) {
    return { files: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadBlob(git: Git, target: Target, rev: string, file: TreeFile): Promise<BlobView> {
  if (file.kind === "submodule") return { lines: [], note: "A submodule: githerd never enters one" };
  if (file.size > MAX_BLOB) return blobText("", file.size);
  try {
    return blobText(await git(target, blobArgs(rev, file.path)), file.size);
  } catch (error) {
    return { lines: [], note: error instanceof Error ? error.message : String(error) };
  }
}
