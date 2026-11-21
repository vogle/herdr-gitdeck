// Claude Code's session logs (~/.claude/projects/<folder>/<session>.jsonl): which
// files a session edited, and when. Nothing records which commit they ended up
// in, so a commit is matched to the sessions that edited its files between its
// parent and itself — a guess, shown as one. Files a shell command only named
// count too, below edited ones: agents often write files from the shell.
// Logs run to hundreds of MB: a perl
// script pulls out only the edit calls, and only from where it last stopped.

import type { Exec, Target } from "../git/runner.ts";
import type { AgentSession } from "./types.ts";

export interface Edit {
  /** The tool call id: a call can be logged twice. */
  tool: string;
  /** Seconds since the epoch. */
  time: number;
  model: string;
  branch: string;
  /** Absolute path; as the command wrote it when `named`. */
  file: string;
  /** Not an edit tool's file but a path a shell command named. */
  named?: true;
}

/** session id → its edits. */
export type SessionEdits = ReadonlyMap<string, readonly Edit[]>;

interface LogEntry {
  size: number;
  mtime: number;
  /** Bytes read so far: whole lines only. */
  offset: number;
  edits: readonly Edit[];
}

/** log path → what was read from it. */
export type ClaudeLogCache = ReadonlyMap<string, LogEntry>;

const TIMEOUT = 25_000;

/** Lists `size<TAB>mtime<TAB>path` for each log in the folders given. */
export const LIST =
  'for my $d (@ARGV) { opendir(my $h, $d) or next; for (sort grep { /\\.jsonl\\z/ } readdir $h) { my $p = "$d/$_"; my @s = stat $p; print "$s[7]\\t$s[9]\\t$p\\n" } }';

/** From byte `offset` of a log: `E<TAB>tool<TAB>time<TAB>model<TAB>branch<TAB>file` per edit call, `B…<TAB>command` per shell call, then `O<TAB>where it stopped`. */
export const SCAN = [
  "my ($off, $f) = @ARGV; open(my $h, '<', $f) or exit 2; seek($h, $off, 0); my $pos = $off;",
  "while (my $l = <$h>) { last unless $l =~ /\\n\\z/; $pos += length($l);",
  "next if index($l, '\"type\":\"tool_use\"') < 0;",
  'my @t = $l =~ /"timestamp":"([^"]*)"/g; my @b = $l =~ /"gitBranch":"([^"]*)"/g; my ($m) = $l =~ /"message":\\{"model":"([^"]*)"/;',
  'my $at = join("\\t", ($t[-1] // ""), ($m // ""), ($b[-1] // ""));',
  'while ($l =~ /"type":"tool_use","id":"([^"]*)","name":"Bash","input":\\{"command":"((?:[^"\\\\]|\\\\.)*)"/g) { print "B\\t$1\\t$at\\t$2\\n" }',
  'while ($l =~ /"type":"tool_use","id":"([^"]*)","name":"(?:Edit|Write|MultiEdit|NotebookEdit)","input":\\{(?:"replace_all":[a-z]*,)?"(?:file_path|notebook_path)":"([^"]*)"/g) {',
  'print "E\\t$1\\t$at\\t$2\\n" } }',
  'print "O\\t$pos\\n";',
].join("\n");

/** "/Volumes/Work/my.repo" → "<home>/.claude/projects/-Volumes-Work-my-repo". */
export const claudeFolder = (home: string, root: string): string => `${home}/.claude/projects/${root.replace(/[^A-Za-z0-9]/g, "-")}`;

export function parseListing(out: string): { size: number; mtime: number; path: string }[] {
  return out.split("\n").flatMap((line) => {
    const [size, mtime, path] = line.split("\t");
    return path && Number.isFinite(Number(size)) && size !== "" ? [{ size: Number(size), mtime: Number(mtime), path }] : [];
  });
}

/** The words of a shell command that look like paths: with a slash or a file extension. */
export function pathTokens(command: string): string[] {
  const words = command.match(/[A-Za-z0-9_@.\-/]+/g) ?? [];
  return [...new Set(words.filter((w) => !w.startsWith("-") && /[A-Za-z]/.test(w) && (w.includes("/") || /\.[A-Za-z0-9]+$/.test(w))))];
}

export function parseScan(out: string): { edits: Edit[]; named: Edit[]; offset: number } {
  let offset = 0;
  const edits: Edit[] = [];
  const named: Edit[] = [];
  for (const line of out.split("\n")) {
    const [kind, ...rest] = line.split("\t");
    if (kind === "O") offset = Number(rest[0]) || 0;
    if ((kind !== "E" && kind !== "B") || rest.length < 5) continue;
    const [tool = "", iso = "", model = "", branch = "", text = ""] = rest;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) continue;
    const at = { tool, time: Math.floor(ms / 1000), model, branch };
    if (kind === "E") edits.push({ ...at, file: text });
    else named.push(...pathTokens(text).map((file) => ({ ...at, file, named: true as const })));
  }
  return { edits, named, offset };
}

const sessionOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");

async function scan(exec: Exec, target: Target, path: string, from: LogEntry | undefined, size: number, mtime: number): Promise<LogEntry | null> {
  if (from && from.size === size && from.mtime === mtime) return from;
  // A log that shrank was rewritten: read it again from the start.
  const base = from && size > from.size ? from : undefined;
  const r = await exec("perl", ["-e", SCAN, String(base?.offset ?? 0), path], { on: target.on, timeout: TIMEOUT });
  if (r.code !== 0) return base ?? null;
  const { edits, named, offset } = parseScan(r.stdout);
  return { size, mtime, offset, edits: [...(base?.edits ?? []), ...edits, ...named] };
}

/** The edits of every log in the folders, reading only logs that changed. Empty when anything fails. */
export async function readClaudeLogs(
  exec: Exec,
  target: Target,
  folders: readonly string[],
  cache: ClaudeLogCache,
): Promise<{ logs: SessionEdits; cache: ClaudeLogCache }> {
  try {
    const listed = await exec("perl", ["-e", LIST, ...folders], { on: target.on, timeout: TIMEOUT });
    if (listed.code !== 0) return { logs: new Map(), cache };
    const entries = await Promise.all(parseListing(listed.stdout).map(async ({ path, size, mtime }) => [path, await scan(exec, target, path, cache.get(path), size, mtime)] as const));
    const next = new Map(entries.flatMap(([path, entry]) => (entry === null ? [] : [[path, entry] as const])));
    return { logs: new Map([...next].map(([path, entry]) => [sessionOf(path), entry.edits])), cache: next };
  } catch {
    return { logs: new Map(), cache };
  }
}

export interface CommitWindow {
  /** The commit's time and its parent's (0 for a root commit), in seconds. */
  time: number;
  parentTime: number;
  /** Paths the commit changed, relative to the repo. */
  files: readonly string[];
  /** The repo's folder and its worktrees'. */
  roots: readonly string[];
  branch: string | null;
}

/** The commit file an edit is about, or null: an edit tool's absolute path, or a command's path relative to the repo. */
function commitFile(e: Edit, commit: CommitWindow, files: ReadonlySet<string>): string | null {
  const path = e.file.startsWith("./") ? e.file.slice(2) : e.file;
  const root = path.startsWith("/") ? commit.roots.find((r) => path.startsWith(`${r}/`)) : "";
  if (root === undefined) return null;
  const relative = root === "" ? path : path.slice(root.length + 1);
  return (root === "" && !e.named) || !files.has(relative) ? null : relative;
}

/**
 * Sessions that touched the commit's files between its parent and itself. Ranked by files an
 * edit tool wrote, then files a command named, then being on the commit's branch.
 */
export function guessClaudeSessions(logs: SessionEdits, commit: CommitWindow): AgentSession[] {
  const files = new Set(commit.files);
  const scored = [...logs].flatMap(([id, edits]) => {
    const hits = edits.flatMap((e) => {
      const file = e.time >= commit.parentTime && e.time <= commit.time ? commitFile(e, commit, files) : null;
      return file === null ? [] : [{ e, file }];
    });
    if (hits.length === 0) return [];
    const last = hits.reduce((a, h) => (h.e.time > a.e.time ? h : a)).e;
    const edited = new Set(hits.filter((h) => !h.e.named).map((h) => h.file));
    const named = new Set(hits.filter((h) => h.e.named && !edited.has(h.file)).map((h) => h.file)).size;
    const branch = commit.branch !== null && hits.some((h) => h.e.branch === commit.branch) ? 1 : 0;
    const session: AgentSession = {
      id, source: "claude", confidence: "guess", agent: "Claude Code", model: last.model === "" ? null : last.model,
      time: last.time, tokens: null, prompt: null, overlap: edited.size, named,
    };
    return [{ session, rank: [edited.size, named, branch] }];
  });
  const order = (a: number[], b: number[]): number => a.reduce((d, x, i) => d || (b[i] ?? 0) - x, 0);
  return scored.sort((a, b) => order(a.rank, b.rank)).map((s) => s.session);
}
