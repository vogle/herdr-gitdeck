// Changed files as a folder tree: each folder a row that opens onto its own folders
// and files. A folder holding only one folder shares that folder's row
// ("rules/moai/"), so deep paths don't stack up empty rows. Every folder starts
// folded: the list reads as folders first, opened one by one or all at once.

import { nameAndFolder } from "./paths.ts";

export interface FolderNode<T> {
  /** "src/ui/", or "" for the repo's top. */
  folder: string;
  /** The row's text below its parent row: "ui/", or a chain like "rules/moai/". */
  label: string;
  /** Its folders, in path order. */
  folders: readonly FolderNode<T>[];
  /** Files directly in it, in the order given. */
  files: readonly T[];
  /** Every file below it, for the row's count and its buttons. */
  all: readonly T[];
  /** Nothing in it is tracked: a wholly new folder, or a folder inside one. */
  isNew: boolean;
}

interface Building<T> {
  folder: string;
  folders: Map<string, Building<T>>;
  files: T[];
}

function finish<T>(b: Building<T>, parent: string, newFolders: readonly string[]): FolderNode<T> {
  let node = b;
  // Join a lone folder into its row, but a wholly new folder keeps its own row.
  while (node.files.length === 0 && node.folders.size === 1 && node.folder !== "" && !newFolders.includes(node.folder)) {
    node = [...node.folders.values()][0] as Building<T>;
  }
  const folders = [...node.folders.values()].sort((x, y) => (x.folder < y.folder ? -1 : 1)).map((c) => finish(c, node.folder, newFolders));
  return {
    folder: node.folder,
    label: node.folder.slice(parent.length),
    folders,
    files: node.files,
    all: [...folders.flatMap((c) => c.all), ...node.files],
    isNew: newFolders.some((n) => node.folder.startsWith(n)),
  };
}

/** The repo's top as a folder ("") holding the files' folders and its own files. */
export function folderTree<T extends { path: string }>(files: readonly T[], newFolders: readonly string[] = []): FolderNode<T> {
  const root: Building<T> = { folder: "", folders: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    // An untracked folder entry ("docs/new/") is a file of its parent.
    for (const part of nameAndFolder(file.path).folder.split("/").slice(0, -1)) {
      const folder = `${node.folder}${part}/`;
      const next = node.folders.get(folder) ?? { folder, folders: new Map(), files: [] };
      node.folders.set(folder, next);
      node = next;
    }
    node.files.push(file);
  }
  return finish(root, "", newFolders);
}

export type ListEntry<T> = { file: T } | { folder: FolderNode<T> };

function find<T>(node: FolderNode<T>, folder: string): FolderNode<T> | undefined {
  if (node.folder === folder) return node;
  for (const c of node.folders) {
    const hit = find(c, folder);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The flat list: each file on its own row, but a wholly new folder stays one
 * folder row (labelled with its whole path) where its first file would be.
 */
export function listEntries<T extends { path: string }>(files: readonly T[], newFolders: readonly string[]): ListEntry<T>[] {
  const outermost = (path: string): string | undefined =>
    newFolders.filter((n) => path.startsWith(n)).sort((x, y) => x.length - y.length)[0];
  const groups = new Map<string, T[]>();
  for (const f of files) {
    const n = outermost(f.path);
    if (n !== undefined) groups.set(n, [...(groups.get(n) ?? []), f]);
  }
  const placed = new Set<string>();
  return files.flatMap((f): ListEntry<T>[] => {
    const n = outermost(f.path);
    if (n === undefined) return [{ file: f }];
    if (placed.has(n)) return [];
    placed.add(n);
    const node = find(folderTree(groups.get(n) ?? [], newFolders), n);
    return node ? [{ folder: { ...node, label: n } }] : [];
  });
}

/** The key a folder's fold toggle is kept under: one section's folder, not the other's. */
export function foldKey(section: string, folder: string): string {
  return `${section}:${folder}`;
}

const inNew = (folder: string, newFolders: readonly string[]): boolean => newFolders.some((n) => folder.startsWith(n));

/**
 * A folder shows open, but a wholly new one (and everything in it) starts folded:
 * an agent's scratch folder is one row until asked for. `flipped` holds the
 * folders the person turned the other way.
 */
export function isOpen(folder: string, flipped: ReadonlySet<string>, section: string, newFolders: readonly string[]): boolean {
  return inNew(folder, newFolders) === flipped.has(foldKey(section, folder));
}

/** The keys of every folder row in a section, at every depth. */
export function folderKeys<T extends { path: string }>(section: string, files: readonly T[], newFolders: readonly string[] = []): string[] {
  const keys = (node: FolderNode<T>): string[] => node.folders.flatMap((f) => [foldKey(section, f.folder), ...keys(f)]);
  return keys(folderTree(files, newFolders));
}

/** Every folder in the section open (or folded); the other section is left as it was. */
export function setAll<T extends { path: string }>(flipped: ReadonlySet<string>, section: string, files: readonly T[], newFolders: readonly string[], open: boolean): Set<string> {
  const next = new Set(flipped);
  for (const key of folderKeys(section, files, newFolders)) {
    const folder = key.slice(section.length + 1);
    if (open === inNew(folder, newFolders)) next.add(key);
    else next.delete(key);
  }
  return next;
}

/** Every folder in the section is open (true when there are none). */
export function allOpen<T extends { path: string }>(flipped: ReadonlySet<string>, section: string, files: readonly T[], newFolders: readonly string[]): boolean {
  return folderKeys(section, files, newFolders).every((key) => isOpen(key.slice(section.length + 1), flipped, section, newFolders));
}

/** The files whose path holds the text, ignoring case. */
export function matching<T extends { path: string }>(files: readonly T[], text: string): readonly T[] {
  const q = text.trim().toLowerCase();
  return q === "" ? files : files.filter((f) => f.path.toLowerCase().includes(q));
}
