// The files at a commit (M4): the tree, and one file's content, both read
// from git's objects (never the work tree, so no filter can run).

import type { Git, Target } from "./git/runner.ts";

export const treeArgs = (rev: string): string[] => ["ls-tree", "-r", "-z", "--long", rev];

export interface TreeFile {
  path: string;
  size: number;
  kind: "file" | "link" | "submodule";
  /** The blob, or for a submodule the commit it records. */
  hash: string;
}

export function parseTree(output: string): TreeFile[] {
  return output
    .split("\0")
    .map((record) => {
      const tab = record.indexOf("\t");
      if (tab < 0) return null;
      const [mode = "", type = "", hash = "", size = ""] = record.slice(0, tab).split(/\s+/);
      const kind = type === "commit" ? "submodule" : mode === "120000" ? "link" : "file";
      return { path: record.slice(tab + 1), size: Number(size) || 0, kind, hash } as TreeFile;
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

const LFS = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n/;

/** A Git LFS pointer file's object id and real size, else null. */
export function lfsPointer(text: string): { oid: string; size: number } | null {
  const m = LFS.exec(text);
  return m ? { oid: m[1] ?? "", size: Number(m[2]) } : null;
}

/** path → url of each submodule in a .gitmodules file. Other keys are ignored. */
export function parseGitmodules(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let path: string | null = null;
  let url: string | null = null;
  const flush = () => {
    if (path !== null && url !== null) out.set(path, url);
    path = url = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) flush();
    const m = /^(path|url)\s*=\s*(.*)$/.exec(line);
    if (m?.[1] === "path") path = m[2] ?? "";
    else if (m?.[1] === "url") url = m[2] ?? "";
  }
  flush();
  return out;
}

export function blobText(text: string, size: number): BlobView {
  const lfs = lfsPointer(text);
  if (lfs) return { lines: [], note: `Git LFS file: ${lfs.size} bytes, sha256:${lfs.oid.slice(0, 12)}… (only its pointer is in git; git-lfs isn't run)` };
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
  if (file.kind === "submodule") {
    // .gitmodules is read raw from the commit, never through git config or git submodule.
    const url = await git(target, blobArgs(rev, ".gitmodules")).then((t) => parseGitmodules(t).get(file.path) ?? null, () => null);
    return { lines: [], note: `Submodule at ${file.hash.slice(0, 10)}, ${url ? `from ${url}` : "no URL recorded"}. gitdeck never enters or updates one` };
  }
  if (file.size > MAX_BLOB) return blobText("", file.size);
  try {
    return blobText(await git(target, blobArgs(rev, file.path)), file.size);
  } catch (error) {
    return { lines: [], note: error instanceof Error ? error.message : String(error) };
  }
}
