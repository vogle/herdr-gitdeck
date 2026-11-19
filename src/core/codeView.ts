// How a file opened at a commit is shown: which language the highlighter
// colors it as, and whether it is markdown, drawn rendered instead.

/** Extensions the highlighter knows under another name (the same table as Herdr's Files tab). */
const ALIASES: Readonly<Record<string, string>> = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js",
  toml: "yaml", jsonc: "json", svelte: "html", vue: "html",
};

const MARKDOWN = new Set(["md", "markdown", "mdx"]);

function extension(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? null : name.slice(dot + 1);
}

/** The highlighter's language for a file; "txt" when it has no extension. */
export function codeLanguage(path: string): string {
  const ext = extension(path);
  return ext === null ? "txt" : (ALIASES[ext] ?? ext);
}

export function isSvg(path: string): boolean {
  return extension(path) === "svg";
}

export function isMarkdown(path: string): boolean {
  const ext = extension(path);
  return ext !== null && MARKDOWN.has(ext);
}
