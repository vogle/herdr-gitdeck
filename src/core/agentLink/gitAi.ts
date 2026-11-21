// Git AI's authorship notes (`git notes --ref=ai`, schema authorship/3.x): which
// lines of a commit each agent session wrote. Before `---` come the files and,
// indented under each, `<key> <ranges>`; after it, JSON naming each key's agent.
// Keys: `s_…::t_…` (a session), `h_…` (a person), or an older prompt hash.

import type { Git, Target } from "../git/runner.ts";
import type { AgentSession } from "./types.ts";

type Json = Record<string, unknown>;

const AGENTS: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini CLI" };

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const asObject = (value: unknown): Json => (typeof value === "object" && value !== null ? (value as Json) : {});

/** "33-35,38-42,45" → 9. A part that isn't a line or a range counts none. */
export function countLines(ranges: string): number {
  return ranges.split(",").reduce((sum, part) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (m === null) return sum;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    return to >= from ? sum + to - from + 1 : sum;
  }, 0);
}

/** key → lines written, from the part before `---`. */
function linesByKey(head: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (const line of head.split("\n")) {
    const m = /^\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (m === null) continue;
    const key = (m[1] ?? "").split("::")[0] ?? "";
    lines.set(key, (lines.get(key) ?? 0) + countLines(m[2] ?? ""));
  }
  return lines;
}

function agentOf(entry: unknown): { tool: string; id: string; model: string | null } | null {
  const agent = asObject(asObject(entry).agent_id);
  const tool = text(agent.tool);
  const id = text(agent.id);
  if (tool === null || id === null) return null;
  const model = text(agent.model);
  return { tool, id, model: model === "unknown" ? null : model };
}

/** The agent sessions a note records, each with the lines it wrote; none for a note of another schema. */
export function parseGitAiNote(note: string, time: number): AgentSession[] {
  const split = note.indexOf("\n---");
  if (split < 0) return [];
  let meta: Json;
  try {
    meta = asObject(JSON.parse(note.slice(split + 4)));
  } catch {
    return [];
  }
  if (!(text(meta.schema_version) ?? "").startsWith("authorship/3.")) return [];
  const lines = linesByKey(note.slice(0, split));
  const keyed = { ...asObject(meta.prompts), ...asObject(meta.sessions) };
  return Object.entries(keyed).flatMap(([key, entry]) => {
    const agent = agentOf(entry);
    if (agent === null) return [];
    const session: AgentSession = {
      id: agent.id,
      source: "git-ai",
      confidence: "exact",
      agent: AGENTS[agent.tool] ?? agent.tool,
      model: agent.model,
      time,
      tokens: null,
      prompt: null,
      lines: lines.get(key) ?? 0,
    };
    return [session];
  });
}

/** The commit's Git AI sessions; none when it has no note. */
export async function gitAiSessions(git: Git, target: Target, hash: string, time: number): Promise<AgentSession[]> {
  const note = await git(target, ["notes", "--ref=ai", "show", hash]).catch(() => "");
  return parseGitAiNote(note, time);
}

/** Notes per `git log`, to keep the argument list short. */
const BATCH = 200;

/** The commits whose note names at least one agent session: one `notes list`, then a `log` per 200 notes. Empty when anything fails. */
export async function gitAiCommits(git: Git, target: Target): Promise<Set<string>> {
  const linked = new Set<string>();
  try {
    const commits = (await git(target, ["notes", "--ref=ai", "list"])).split("\n").flatMap((l) => l.trim().split(/\s+/)[1] ?? []);
    for (let i = 0; i < commits.length; i += BATCH) {
      const out = await git(target, ["log", "--no-walk", "--notes=ai", "--format=%H%x1f%N%x1e", ...commits.slice(i, i + BATCH)]).catch(() => "");
      for (const record of out.split("\x1e")) {
        const [hash, note] = record.trim().split("\x1f");
        if (hash && note && parseGitAiNote(note, 0).length > 0) linked.add(hash);
      }
    }
  } catch {
    return new Set();
  }
  return linked;
}
