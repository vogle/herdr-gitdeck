// Git AI's authorship notes (`git notes --ref=ai`, schema authorship/3.x): which
// lines of a commit each agent session wrote. Before `---` come the files and,
// indented under each, `<key> <ranges>`; after it, JSON naming each key's agent.
// Keys: `s_…::t_…` (a session), `h_…` (a person), or an older prompt hash.

import type { Git, Target } from "../git/runner.ts";
import type { BlameLine } from "../inspect.ts";
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

/** `<file>` lines, each followed by indented `<key> <ranges>` lines: the part before `---`. */
function entries(head: string): { file: string; key: string; ranges: string }[] {
  let file = "";
  return head.split("\n").flatMap((line) => {
    const m = /^\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (m === null) {
      if (line.trim() !== "") file = line.trim();
      return [];
    }
    return [{ file, key: (m[1] ?? "").split("::")[0] ?? "", ranges: m[2] ?? "" }];
  });
}

/** key → lines written. */
function linesByKey(head: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (const e of entries(head)) lines.set(e.key, (lines.get(e.key) ?? 0) + countLines(e.ranges));
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

/** The part before `---` and the JSON after it; null for a note of another schema. */
function splitNote(note: string): { head: string; keyed: Json } | null {
  const split = note.indexOf("\n---");
  if (split < 0) return null;
  let meta: Json;
  try {
    meta = asObject(JSON.parse(note.slice(split + 4)));
  } catch {
    return null;
  }
  if (!(text(meta.schema_version) ?? "").startsWith("authorship/3.")) return null;
  return { head: note.slice(0, split), keyed: { ...asObject(meta.prompts), ...asObject(meta.sessions) } };
}

/** The agent sessions a note records, each with the lines it wrote; none for a note of another schema. */
export function parseGitAiNote(note: string, time: number): AgentSession[] {
  const parsed = splitNote(note);
  if (parsed === null) return [];
  const lines = linesByKey(parsed.head);
  return Object.entries(parsed.keyed).flatMap(([key, entry]) => {
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

interface Span {
  from: number;
  to: number;
  agent: string;
}

/** file → the line spans agents wrote, in the commit's version of the file. */
export type NoteLines = ReadonlyMap<string, readonly Span[]>;

/** The lines each agent session wrote, by file; a person's lines (`h_…`) have no agent and are left out. */
export function noteLines(note: string): NoteLines {
  const parsed = splitNote(note);
  if (parsed === null) return new Map();
  const files = new Map<string, Span[]>();
  for (const { file, key, ranges } of entries(parsed.head)) {
    const agent = agentOf(parsed.keyed[key]);
    if (agent === null) continue;
    const spans = ranges.split(",").flatMap((part) => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
      return m === null ? [] : [{ from: Number(m[1]), to: Number(m[2] ?? m[1]), agent: AGENTS[agent.tool] ?? agent.tool }];
    });
    files.set(file, [...(files.get(file) ?? []), ...spans]);
  }
  return files;
}

export const agentAt = (files: NoteLines, path: string, line: number): string | null =>
  files.get(path)?.find((s) => line >= s.from && line <= s.to)?.agent ?? null;

/** commit → its note's lines, or null for a commit without a note. */
export type NoteCache = ReadonlyMap<string, NoteLines | null>;

/** Blame lines with the agent Git AI recorded for each, read from the line's own commit, file and number there. */
export function withBlameAgents(lines: readonly BlameLine[], notes: NoteCache): BlameLine[] {
  return lines.map((l) => {
    const files = notes.get(l.hash);
    const agent = files ? agentAt(files, l.origPath, l.origLine) : null;
    return agent === null ? l : { ...l, agent };
  });
}

/** The notes of commits not read yet, one `log` per 200; uncommitted lines (an all-zero hash) are skipped. A failed read is left out, to try again. */
export async function readNoteLines(git: Git, target: Target, hashes: readonly string[], cache: NoteCache): Promise<NoteCache> {
  const wanted = [...new Set(hashes)].filter((h) => !cache.has(h) && !/^0+$/.test(h));
  const read = new Map(cache);
  for (let i = 0; i < wanted.length; i += BATCH) {
    try {
      const out = await git(target, ["log", "--no-walk", "--notes=ai", "--format=%H%x1f%N%x1e", ...wanted.slice(i, i + BATCH)]);
      for (const record of out.split("\x1e")) {
        const [hash, note = ""] = record.trim().split("\x1f");
        if (hash) read.set(hash, note.trim() === "" ? null : noteLines(note));
      }
    } catch {
      // Not cached: the next blame asks again.
    }
  }
  return read;
}
