// Entire's checkpoints (refs/entire/checkpoints/<xx>/<id>): each names the commit
// it was taken for and the sessions behind it. Only the small metadata.json and
// prompt.txt blobs are read, never the transcripts (full.jsonl).

import type { Git, Target } from "../git/runner.ts";
import type { AgentSession } from "./types.ts";
import { promptText } from "./text.ts";

const PREFIX = "refs/entire/checkpoints/";
/** Refs per `git show`, to keep the argument list short. */
const BATCH = 200;
const MAX_PROMPT = 2000;

export interface CheckpointEntry {
  ref: string;
  /** The session folders inside the checkpoint: "0", "1", … */
  sessions: readonly string[];
}

/** commit sha → the checkpoints taken for it. */
export type EntireIndex = ReadonlyMap<string, readonly CheckpointEntry[]>;

type Json = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const parseCheckpointRefs = (output: string): string[] =>
  output.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(PREFIX));

/** The JSON objects `git show a:x b:x` prints one after another; a broken one is skipped. */
export function splitJsonObjects(output: string): Json[] {
  const objects: Json[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < output.length; i += 1) {
    const c = output[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          objects.push(JSON.parse(output.slice(start, i + 1)) as Json);
        } catch {
          // Not JSON after all: leave it out.
        }
      }
    }
  }
  return objects;
}

/** "/1/metadata.json" → "1"; a checkpoint that lists none holds folder "0". */
function sessionFolders(top: Json): string[] {
  const list = Array.isArray(top.sessions) ? top.sessions : [];
  const folders = list
    .map((s) => /^\/?([^/]+)\/metadata\.json$/.exec(text((s as Json)?.metadata) ?? "")?.[1])
    .filter((f): f is string => f !== undefined);
  return folders.length > 0 ? folders : ["0"];
}

const idOf = (ref: string): string => ref.slice(ref.lastIndexOf("/") + 1);

export function parseCheckpointIndex(output: string, refs: readonly string[]): Map<string, CheckpointEntry[]> {
  const byId = new Map(refs.map((ref) => [idOf(ref), ref]));
  const index = new Map<string, CheckpointEntry[]>();
  for (const top of splitJsonObjects(output)) {
    const ref = byId.get(text(top.checkpoint_id) ?? "");
    const sha = text(top.commit_sha);
    if (ref === undefined || sha === null) continue;
    index.set(sha, [...(index.get(sha) ?? []), { ref, sessions: sessionFolders(top) }]);
  }
  return index;
}

export function parseSessionMeta(meta: Json): AgentSession | null {
  const id = text(meta.session_id);
  if (id === null) return null;
  const usage = (meta.token_usage ?? {}) as Json;
  const tokens = count(usage.input_tokens) + count(usage.cache_creation_tokens) + count(usage.cache_read_tokens) + count(usage.output_tokens);
  const created = Date.parse(text(meta.created_at) ?? "");
  return {
    id,
    source: "entire",
    confidence: "exact",
    agent: text(meta.agent) ?? "Agent",
    model: text(meta.model),
    time: Number.isNaN(created) ? 0 : Math.floor(created / 1000),
    tokens: meta.token_usage === undefined ? null : tokens,
    prompt: null,
  };
}

/** The `Entire-Checkpoint: <id>` trailer Entire can add to a commit message. */
export const checkpointFromMessage = (message: string): string | null =>
  /^Entire-Checkpoint:\s*(\S+)\s*$/m.exec(message)?.[1] ?? null;

const listRefs = async (git: Git, target: Target): Promise<string[]> =>
  parseCheckpointRefs(await git(target, ["for-each-ref", "--format=%(refname)", PREFIX]));

async function readTops(git: Git, target: Target, refs: readonly string[]): Promise<string> {
  const chunks: string[] = [];
  for (let i = 0; i < refs.length; i += BATCH) {
    const specs = refs.slice(i, i + BATCH).map((ref) => `${ref}:metadata.json`);
    // A checkpoint without a top-level metadata.json fails the whole show: that batch is left out.
    chunks.push(await git(target, ["show", "--no-color", ...specs]).catch(() => ""));
  }
  return chunks.join("\n");
}

/** Every checkpoint's commit, from one for-each-ref and a `git show` per 200 checkpoints. Empty when anything fails. */
export async function loadEntireIndex(git: Git, target: Target): Promise<EntireIndex> {
  try {
    const refs = await listRefs(git, target);
    if (refs.length === 0) return new Map();
    return parseCheckpointIndex(await readTops(git, target, refs), refs);
  } catch {
    return new Map();
  }
}

/** The checkpoint a commit message names, when the index doesn't have the commit (a rebased or amended one). */
async function fromTrailer(git: Git, target: Target, message: string): Promise<CheckpointEntry[]> {
  const id = checkpointFromMessage(message);
  if (id === null) return [];
  const ref = (await listRefs(git, target)).find((r) => idOf(r) === id);
  if (ref === undefined) return [];
  const [top] = splitJsonObjects(await readTops(git, target, [ref]));
  return top === undefined ? [] : [{ ref, sessions: sessionFolders(top) }];
}

interface Found {
  session: AgentSession;
  spec: string;
}

/** One `git show` per 200 metadata files; a batch with a missing file is read file by file instead. */
async function readMetas(git: Git, target: Target, specs: readonly string[]): Promise<Found[]> {
  const found: Found[] = [];
  for (let i = 0; i < specs.length; i += BATCH) {
    const batch = specs.slice(i, i + BATCH);
    const metas = splitJsonObjects(await git(target, ["show", "--no-color", ...batch]).catch(() => ""));
    const pairs = metas.length === batch.length
      ? metas.map((meta, j) => ({ meta, spec: batch[j] ?? "" }))
      : await Promise.all(batch.map(async (spec) => ({ meta: splitJsonObjects(await git(target, ["show", "--no-color", spec]).catch(() => ""))[0], spec })));
    for (const { meta, spec } of pairs) {
      const session = meta === undefined ? null : parseSessionMeta(meta);
      if (session !== null) found.push({ session, spec });
    }
  }
  return found;
}

/** Each session once, from its latest checkpoint. */
function latestPerSession(found: readonly Found[]): Found[] {
  const byId = new Map<string, Found>();
  for (const f of found) {
    const seen = byId.get(f.session.id);
    if (seen === undefined || f.session.time > seen.session.time) byId.set(f.session.id, f);
  }
  return [...byId.values()];
}

async function withPrompt(git: Git, target: Target, { session, spec }: Found): Promise<AgentSession> {
  const file = spec.replace(/metadata\.json$/, "prompt.txt");
  const prompt = promptText(await git(target, ["show", "--no-color", file]).catch(() => ""));
  return { ...session, prompt: prompt === "" ? null : prompt.slice(0, MAX_PROMPT) };
}

/** The sessions behind one commit, with their prompts: read when the commit is opened. A session that can't be read is skipped. */
export async function entireSessions(
  git: Git,
  target: Target,
  commit: { hash: string; message: string },
  index: EntireIndex,
): Promise<AgentSession[]> {
  const entries = index.get(commit.hash) ?? (await fromTrailer(git, target, commit.message).catch(() => []));
  const specs = entries.flatMap((entry) => entry.sessions.map((folder) => `${entry.ref}:${folder}/metadata.json`));
  const sessions = latestPerSession(await readMetas(git, target, specs));
  return Promise.all(sessions.map((found) => withPrompt(git, target, found)));
}
