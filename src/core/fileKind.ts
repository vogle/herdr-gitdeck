// What kind of file a path names, for the icon its row shows (the icon's color
// says its status). Known by the whole name first, then by the extension.

import { basename } from "./paths.ts";

export type FileKind = "code" | "text" | "json" | "config" | "lock" | "image" | "terminal" | "file";

const BY_NAME: Readonly<Record<string, FileKind>> = {
  dockerfile: "config",
  makefile: "terminal",
  "pnpm-lock.yaml": "lock",
  "package-lock.json": "lock",
  "yarn.lock": "lock",
  "cargo.lock": "lock",
  "go.sum": "lock",
};

const EXTENSIONS: ReadonlyArray<readonly [FileKind, readonly string[]]> = [
  ["code", ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "rb", "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "lua", "zig", "scala", "dart", "ex", "exs", "vue", "svelte", "astro", "html", "css", "scss", "sql"]],
  ["text", ["md", "mdx", "txt", "rst", "adoc"]],
  ["json", ["json", "jsonc", "json5"]],
  ["config", ["yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "properties"]],
  ["lock", ["lock", "pem", "key"]],
  ["image", ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]],
  ["terminal", ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]],
];

const BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map(EXTENSIONS.flatMap(([kind, exts]) => exts.map((e) => [e, kind] as const)));

export function fileKind(path: string): FileKind {
  const name = basename(path).toLowerCase();
  const known = BY_NAME[name];
  if (known) return known;
  if (name === ".env" || name.startsWith(".env.")) return "lock";
  // Dotfiles with nothing after the dot (".gitignore", ".worktreeinclude") are settings.
  if (name.startsWith(".") && name.lastIndexOf(".") === 0) return "config";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "file";
  return BY_EXTENSION.get(name.slice(dot + 1)) ?? "file";
}

/**
 * The icon for a line of .git/info/exclude: a folder for "name/", the file's kind
 * for one plain name, and a plain file for a wildcard that can match many.
 */
export function patternKind(line: string): FileKind | "folder" {
  const bare = line.replace(/\\./g, "x");
  if (/[*?[]/.test(bare)) return "file";
  if (line.endsWith("/")) return "folder";
  return fileKind(line.replace(/^\//, ""));
}
