import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countLines, gitAiSessions, parseGitAiNote } from "../../src/core/agentLink/gitAi.ts";
import type { Git } from "../../src/core/git/runner.ts";

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/agentLink/${name}`, import.meta.url), "utf8");
const TARGET = { cwd: "/repo", on: null };

test("countLines counts single lines and ranges", () => {
  assert.equal(countLines("1-10,15-20"), 16);
  assert.equal(countLines("33-35,38-42,45"), 9);
  assert.equal(countLines(""), 0);
  assert.equal(countLines("x,3-1"), 0);
});

test("a session note gives one agent session with the lines it wrote", () => {
  const sessions = parseGitAiNote(fixture("gitai-note-session.txt"), 1000);
  assert.deepEqual(sessions, [{
    id: "11111111-2222-3333-4444-555555555555",
    source: "git-ai",
    confidence: "exact",
    agent: "Claude Code",
    model: null,
    time: 1000,
    tokens: null,
    prompt: null,
    lines: 9 + 15,
  }]);
});

test("a note with only human keys has no agent sessions", () => {
  assert.deepEqual(parseGitAiNote(fixture("gitai-note-human.txt"), 0), []);
});

test("a note of another schema version is skipped without an error", () => {
  const old = fixture("gitai-note-session.txt").replace("authorship/3.0.0", "authorship/2.0.0");
  assert.deepEqual(parseGitAiNote(old, 0), []);
  assert.deepEqual(parseGitAiNote("not a note", 0), []);
});

test("an older note keyed by prompt hash still names its agent", () => {
  const note = [
    "a.ts",
    "  abc123 1-10,15-20",
    "---",
    JSON.stringify({ schema_version: "authorship/3.0.0", prompts: { abc123: { agent_id: { tool: "codex", id: "cx-1", model: "gpt-5" } } } }),
  ].join("\n");
  const [session] = parseGitAiNote(note, 5);
  assert.equal(session?.agent, "Codex");
  assert.equal(session?.model, "gpt-5");
  assert.equal(session?.lines, 16);
});

test("gitAiSessions reads the commit's note, and has none when there is no note", async () => {
  const note = fixture("gitai-note-session.txt");
  const git: Git = async (_t, args) => {
    assert.deepEqual(args.slice(0, 3), ["notes", "--ref=ai", "show"]);
    if (args[3] === "abc") return note;
    throw new Error("no note found");
  };
  assert.equal((await gitAiSessions(git, TARGET, "abc", 7)).length, 1);
  assert.deepEqual(await gitAiSessions(git, TARGET, "def", 7), []);
});

test("gitAiCommits lists the commits whose note names an agent session, from one log per 200 notes", async () => {
  const session = fixture("gitai-note-session.txt");
  const human = fixture("gitai-note-human.txt");
  const calls: string[][] = [];
  const git: Git = async (_t, args) => {
    calls.push(args);
    if (args[0] === "notes") return "n1 aaa\nn2 bbb\n";
    return `aaa\x1f${session}\x1e\nbbb\x1f${human}\x1e\n`;
  };
  const { gitAiCommits } = await import("../../src/core/agentLink/gitAi.ts");
  assert.deepEqual([...(await gitAiCommits(git, TARGET))], ["aaa"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.slice(0, 3), ["log", "--no-walk", "--notes=ai"]);
});

test("gitAiCommits is empty without notes or when git fails", async () => {
  const { gitAiCommits } = await import("../../src/core/agentLink/gitAi.ts");
  assert.equal((await gitAiCommits(async () => "", TARGET)).size, 0);
  assert.equal((await gitAiCommits(async () => { throw new Error("no notes ref"); }, TARGET)).size, 0);
});

const SESSION_NOTE = fixture("gitai-note-session.txt");
const HUMAN_NOTE = fixture("gitai-note-human.txt");

test("noteLines: the lines of each file an agent session wrote, people's lines left out", async () => {
  const { noteLines, agentAt } = await import("../../src/core/agentLink/gitAi.ts");
  const files = noteLines(SESSION_NOTE);
  assert.equal(agentAt(files, "src/core/codeView.ts", 33), "Claude Code");
  assert.equal(agentAt(files, "src/core/codeView.ts", 36), null);
  assert.equal(agentAt(files, "src/core/codeView.ts", 45), "Claude Code");
  assert.equal(agentAt(files, "tests/codeView.test.ts", 47), "Claude Code");
  assert.equal(agentAt(files, "other.ts", 33), null);
  assert.equal(agentAt(noteLines(HUMAN_NOTE), ".entire/.gitignore", 1), null);
  assert.equal(noteLines("no note").size, 0);
});

test("withBlameAgents marks the lines AC-4 names and no others", async () => {
  const { withBlameAgents, noteLines: noteLinesOf } = await import("../../src/core/agentLink/gitAi.ts");
  const meta = JSON.stringify({ schema_version: "authorship/3.0.0", sessions: { s_1: { agent_id: { tool: "claude", id: "x", model: "m" } } } });
  const notes = new Map([["c1", noteLinesOf(`a.ts\n  s_1::t_1 3-5\n---\n${meta}`)], ["c2", null]]);
  const line = (n: number, hash = "c1") => ({ hash, line: n, origLine: n, origPath: "a.ts", text: "", author: "Ann", time: 0, summary: "", first: n === 1 });
  const marked = withBlameAgents([1, 2, 3, 4, 5, 6].map((n) => line(n)).concat(line(3, "c2")), notes);
  assert.deepEqual(marked.map((l) => l.agent ?? null), [null, null, "Claude Code", "Claude Code", "Claude Code", null, null]);
});

test("readNoteLines reads the notes of the blamed commits once, in one log, and skips uncommitted lines", async () => {
  const { readNoteLines } = await import("../../src/core/agentLink/gitAi.ts");
  const calls: string[][] = [];
  const git = async (_t: unknown, args: string[]) => {
    calls.push(args);
    return `c1\x1f${SESSION_NOTE}\x1e\nc2\x1f\x1e\n`;
  };
  const zero = "0".repeat(40);
  const first = await readNoteLines(git, TARGET, ["c1", "c2", "c1", zero], new Map());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(-2), ["c1", "c2"]);
  assert.ok(first.get("c1")?.size);
  assert.equal(first.get("c2"), null);
  await readNoteLines(git, TARGET, ["c1", "c2"], first);
  assert.equal(calls.length, 1, "notes already read are not read again");
  const failing = async () => { throw new Error("no git"); };
  assert.equal((await readNoteLines(failing, TARGET, ["c3"], first)).has("c3"), false);
});
