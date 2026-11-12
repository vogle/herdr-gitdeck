// "Ignore locally": list a path in the repo's own exclude file (.git/info/exclude),
// which works like .gitignore but is never committed. Agents leave scratch folders
// (.claude/, .moai/) behind; this hides them without touching the project's files.

import type { Git, Target } from "./git/runner.ts";
import type { Files } from "./staging.ts";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The path anchored at the repo root, with gitignore's special characters escaped. */
export function excludePattern(path: string): string {
  const escaped = path.replace(/[\\[\]*?!#]/g, (c) => `\\${c}`).replace(/ $/, "\\ ");
  return `/${escaped}`;
}

/** The exclude file's text with the path added on a line of its own, or null when it's already there. */
export function withExcluded(text: string, path: string): string | null {
  const pattern = excludePattern(path);
  if (text.split("\n").some((line) => line.trim() === pattern)) return null;
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${sep}${pattern}\n`;
}

/** The patterns in an exclude file, without its comments and blank lines. */
export function excludedLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
}

/** A pattern as the file list names its path: no root anchor, no escapes. */
export function excludeLabel(line: string): string {
  return line.replace(/^\//, "").replace(/\\(.)/g, "$1");
}

/** The exclude file's text without the pattern's line, or null when it isn't there. */
export function withoutExcluded(text: string, line: string): string | null {
  const lines = text.split("\n");
  const kept = lines.filter((l) => l.trim() !== line);
  return kept.length === lines.length ? null : kept.join("\n");
}

const LOCAL_ONLY = "Ignoring a file works only for repos on this machine";

/** Where git keeps this repo's exclude file (in the main repo for a linked worktree). */
async function excludeFile(git: Git, target: Target): Promise<string> {
  const answer = (await git(target, ["rev-parse", "--git-path", "info/exclude"])).trim();
  return answer.startsWith("/") ? answer : `${target.cwd}/${answer}`;
}

/** Rewrites the exclude file with `change`; returns an error text, or null when done. */
async function editExclude(git: Git, files: Files, target: Target, change: (text: string) => string | null): Promise<string | null> {
  if (target.on !== null) return LOCAL_ONLY;
  try {
    const file = await excludeFile(git, target);
    const current = await files.read(file);
    const next = change(current ?? "");
    if (next !== null) await files.write(file, next, current);
    return null;
  } catch (error) {
    return message(error);
  }
}

/** Adds the path to the repo's exclude file; returns an error text, or null when done. */
export const excludeLocally = (git: Git, files: Files, target: Target, path: string): Promise<string | null> =>
  editExclude(git, files, target, (text) => withExcluded(text, path));

/** Takes a pattern back out of the exclude file, so its files show again. */
export const unexcludeLocally = (git: Git, files: Files, target: Target, line: string): Promise<string | null> =>
  editExclude(git, files, target, (text) => withoutExcluded(text, line));

/** The patterns this repo ignores locally; empty for another machine's repo or on any error. */
export async function readExcluded(git: Git, files: Files, target: Target): Promise<string[]> {
  if (target.on !== null) return [];
  try {
    return excludedLines((await files.read(await excludeFile(git, target))) ?? "");
  } catch {
    return [];
  }
}
