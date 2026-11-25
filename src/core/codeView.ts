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

const ZWSP = "\u200b";
/** HTML elements that can load something from a URL; any other tag (p, b, br, a, details) stays HTML. */
const FETCHING_TAG = /<(\/?)(?=(?:img|image|picture|source|video|audio|track|svg|use|math|iframe|frame|frameset|object|embed|link|style|script|input|meta|base)\b)/gi;

/**
 * Markdown that opening fetches nothing from: a file from the repo may point at
 * any server. `![` becomes `!` + a zero-width space + `[`, so a picture is drawn
 * as a link (opened only on a click), and a tag that could load a URL loses its
 * `<`, so it shows as text. Nothing is rebuilt from the file's own text, and
 * where the space lands inside code it can't be seen.
 */
export function markdownWithoutImages(markdown: string): string {
  return markdown.replace(/!\[/g, `!${ZWSP}[`).replace(FETCHING_TAG, `<$1${ZWSP}`);
}
