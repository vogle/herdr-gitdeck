// "✨ Suggest": the person's own coding agent (Claude Code, Codex or Gemini)
// writes the commit message from the staged diff, in the style of the repo's
// recent subjects. One non-interactive call that can't edit anything. Runs only
// when asked: the diff goes to that agent's service.

import type { Exec, Git, Target } from "./git/runner.ts";
import { SAFE_DIFF } from "./git/show.ts";

/** Characters of diff sent; the stat still names every file. */
export const MAX_DIFF = 20_000;
const TIMEOUT_MS = 90_000;

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

/** An agent that can write the message, keyed like Herdr's program table. */
export interface Writer {
  key: "claude" | "codex" | "gemini";
  name: string;
  command: string;
}

export const WRITERS = {
  claude: { key: "claude", name: "Claude Code", command: "claude" },
  codex: { key: "codex", name: "Codex", command: "codex" },
  gemini: { key: "gemini", name: "Gemini", command: "gemini" },
} as const satisfies Record<string, Writer>;

const isWriterKey = (key: string): key is Writer["key"] => Object.hasOwn(WRITERS, key);

/**
 * The agent to ask: one working in this repo, else the first installed one in
 * Herdr's menu order (most picked first), else null.
 */
export function pickWriter(repoKeys: readonly string[], installedKeys: readonly string[]): Writer | null {
  const key = repoKeys.find(isWriterKey) ?? installedKeys.find(isWriterKey);
  return key === undefined ? null : WRITERS[key];
}

/** One plain-text answer, with no tools that change files, hooks or saved session. */
export function writerArgs(writer: Writer, prompt: string): string[] {
  switch (writer.key) {
    case "claude":
      return [
        "-p", prompt,
        "--model", "haiku",
        "--tools", "",
        "--setting-sources", "user",
        "--settings", JSON.stringify({ disableAllHooks: true }),
        "--strict-mcp-config",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--output-format", "text",
      ];
    case "codex":
      return ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--color", "never", prompt];
    case "gemini":
      return ["-p", prompt, "--output-format", "text"];
  }
}

async function recentSubjects(git: Git, target: Target): Promise<string> {
  try {
    return await git(target, ["log", "-8", "--format=%s"]);
  } catch {
    return ""; // No commits yet.
  }
}

/** Asks the given agent for a message for the staged changes. */
export async function suggestWithAi(git: Git, exec: Exec, target: Target, writer: Writer | null): Promise<AiResult> {
  if (writer === null) return { error: "No coding agent to write the message: install Claude Code, Codex or Gemini" };
  if (target.on !== null) return { error: "AI suggestions work only for repos on this machine" };
  let prompt: string;
  try {
    const stat = await git(target, ["diff", ...SAFE_DIFF, "--cached", "--stat"]);
    if (stat.trim() === "") return { error: "Stage a file first: the suggestion reads the staged changes" };
    prompt = aiPrompt(stat, await git(target, ["diff", ...SAFE_DIFF, "--cached"]), await recentSubjects(git, target));
  } catch (error) {
    return { error: message(error) };
  }
  let result;
  try {
    // Run outside the repo so its agent files and project settings stay out of the call.
    result = await exec(writer.command, writerArgs(writer, prompt), { cwd: "/tmp", timeout: TIMEOUT_MS });
  } catch {
    return { error: `${writer.name} (${writer.command}) couldn't start: is it installed?` };
  }
  const text = cleanMessage(result.stdout);
  if (result.code === 0 && text !== "") return { message: text };
  const why = result.stderr.trim().split("\n")[0] ?? "";
  return { error: why === "" ? `${writer.name} stopped without a message` : `${writer.name}: ${why}` };
}
