// "✨ Suggest": Claude Code writes the commit message from the staged diff, in
// the style of the repo's recent subjects. One `claude -p` call: no tools, no
// hooks, the small model, so it answers in seconds. Runs only when asked: the
// diff goes to Anthropic.

import type { Exec, Git, Target } from "./git/runner.ts";

/** Characters of diff sent; the stat still names every file. */
export const MAX_DIFF = 20_000;
const TIMEOUT_MS = 90_000;
const MODEL = "haiku";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type AiResult = { message: string } | { error: string };

export function aiPrompt(stat: string, diff: string, subjects: string): string {
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[diff cut at ${MAX_DIFF} characters]` : diff;
  return [
    "Write a git commit message for the staged changes below.",
    subjects.trim() === "" ? "" : `Match the style of this repository's recent commit subjects:\n${subjects.trim()}\n`,
    "Reply with only the message: a subject line under 72 characters, then optionally a blank line and a short body. No code fences, no commentary.",
    "",
    `Files:\n${stat}`,
    "",
    `Staged changes:\n${cut}`,
  ].join("\n");
}

/** The reply without surrounding space or a code fence around it. */
export function cleanMessage(text: string): string {
  return text.trim().replace(/^```[^\n]*\n/, "").replace(/\n?```$/, "").trim();
}

function claudeArgs(prompt: string): string[] {
  return [
    "-p", prompt,
    "--model", MODEL,
    "--tools", "",
    "--setting-sources", "user",
    "--settings", JSON.stringify({ disableAllHooks: true }),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--output-format", "text",
  ];
}

async function recentSubjects(git: Git, target: Target): Promise<string> {
  try {
    return await git(target, ["log", "-8", "--format=%s"]);
  } catch {
    return ""; // No commits yet.
  }
}

/** Asks Claude Code for a message for the staged changes. */
export async function suggestWithAi(git: Git, exec: Exec, target: Target): Promise<AiResult> {
  if (target.on !== null) return { error: "AI suggestions work only for repos on this machine" };
  let prompt: string;
  try {
    const stat = await git(target, ["diff", "--cached", "--stat"]);
    if (stat.trim() === "") return { error: "Stage a file first: the suggestion reads the staged changes" };
    prompt = aiPrompt(stat, await git(target, ["diff", "--cached"]), await recentSubjects(git, target));
  } catch (error) {
    return { error: message(error) };
  }
  let result;
  try {
    // Run outside the repo so its CLAUDE.md and project settings stay out of the call.
    result = await exec("claude", claudeArgs(prompt), { cwd: "/tmp", timeout: TIMEOUT_MS });
  } catch {
    return { error: "Claude Code (claude) couldn't start: is it installed?" };
  }
  const text = cleanMessage(result.stdout);
  if (result.code === 0 && text !== "") return { message: text };
  const why = result.stderr.trim().split("\n")[0] ?? "";
  return { error: why === "" ? "Claude Code stopped without a message" : `Claude Code: ${why}` };
}
