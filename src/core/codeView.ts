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

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** `![alt](url)` or `![alt][ref]`, not after a backslash. */
const MD_IMAGE = /(^|[^\\])!\[([^\]]*)\](?=[([])/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;

function htmlImageLink(tag: string): string {
  const attr = (name: string): string => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? "";
  return `[${attr("alt") || "image"}](${attr("src")})`;
}

/**
 * Markdown with its pictures drawn as links: a file from the repo may point at
 * any server, and opening it to read must not fetch from there. Code blocks
 * are left as written.
 */
export function markdownWithoutImages(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const mark = FENCE.exec(line)?.[1];
      if (mark && (fence === null || (mark[0] === fence[0] && mark.length >= fence.length))) {
        fence = fence === null ? mark : null;
        return line;
      }
      if (fence !== null) return line;
      return line.replace(MD_IMAGE, (_m, before: string, alt: string) => `${before}[${alt || "image"}]`).replace(HTML_IMAGE, htmlImageLink);
    })
    .join("\n");
}
