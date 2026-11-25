// The files at a commit as a folder tree, the way the Changes tab draws its
// files: folders first, each folded until opened, then the folder's own files.
// A folder holding only one folder shares its row ("docs/deep/").

import { folderTree, type FolderNode } from "./fileGroups.ts";
import { nameAndFolder } from "./paths.ts";
import type { TreeFile } from "./tree.ts";

export type TreeRow =
  | { kind: "folder"; folder: string; label: string; depth: number; open: boolean; count: number }
  | { kind: "file"; file: TreeFile; name: string; index: number; depth: number };

/** The rows to draw: the open folders' contents, each row with how far in it sits; `index` is the file's place in `files`. */
export function treeRows(files: readonly TreeFile[], open: ReadonlySet<string>): TreeRow[] {
  const index = new Map(files.map((f, i) => [f.path, i]));
  const walk = (node: FolderNode<TreeFile>, depth: number): TreeRow[] => [
    ...node.folders.flatMap((g): TreeRow[] => {
      const shown = open.has(g.folder);
      const head: TreeRow = { kind: "folder", folder: g.folder, label: g.label, depth, open: shown, count: g.all.length };
      return shown ? [head, ...walk(g, depth + 1)] : [head];
    }),
    ...node.files.map((file): TreeRow => ({ kind: "file", file, name: nameAndFolder(file.path).name, index: index.get(file.path) ?? -1, depth })),
  ];
  return walk(folderTree(files), 0);
}

/** The open folders with `folder` turned the other way. */
export function toggleFolder(open: ReadonlySet<string>, folder: string): ReadonlySet<string> {
  return open.has(folder) ? new Set([...open].filter((f) => f !== folder)) : new Set([...open, folder]);
}

/** A file's size as a file browser writes it: bytes, then KB and MB with one decimal under 10. */
export function sizeText(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${bytes} B`;
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}
