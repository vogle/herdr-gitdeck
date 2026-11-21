import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkpointFromMessage,
  entireSessions,
  loadEntireIndex,
  parseCheckpointIndex,
  parseCheckpointRefs,
  parseSessionMeta,
  splitJsonObjects,
} from "../../src/core/agentLink/entire.ts";
import type { Git } from "../../src/core/git/runner.ts";

const SESSION = readFileSync(new URL("../fixtures/agentLink/entire-metadata.json", import.meta.url), "utf8");
const REF = "refs/entire/checkpoints/1S/01M7VH6HT8NZ61PS305PHFH71S";
const SHA = "8db443daee65ae4b30aebf2c04cc2aa4cfcab432";
const TARGET = { cwd: "/repo", on: null };

const top = (id: string, sha: string, sessions: string[]): string =>
  JSON.stringify({ checkpoint_id: id, commit_sha: sha, sessions: sessions.map((s) => ({ metadata: `/${s}/metadata.json` })) }, null, 2);

test("parseCheckpointRefs keeps only checkpoint refs", () => {
  assert.deepEqual(parseCheckpointRefs(`${REF}\nrefs/heads/main\n\n`), [REF]);
});

test("splitJsonObjects reads blobs git show prints back to back, braces inside strings included", () => {
  const out = `{\n  "a": "}{"\n}\n{\n  "b": [1, {"c": 2}]\n}\n`;
  assert.deepEqual(splitJsonObjects(out), [{ a: "}{" }, { b: [1, { c: 2 }] }]);
});

test("splitJsonObjects skips a broken blob and keeps the rest", () => {
  assert.deepEqual(splitJsonObjects(`{ "a": tru }\n{ "b": 1 }`), [{ b: 1 }]);
});

test("parseCheckpointIndex maps each commit to its checkpoint ref and session folders", () => {
  const other = "refs/entire/checkpoints/03/01M7RRH23XA6WPP5HVC9FBE703";
  const out = `${top("01M7VH6HT8NZ61PS305PHFH71S", SHA, ["0", "1"])}\n${top("01M7RRH23XA6WPP5HVC9FBE703", "abc", ["0"])}\n`;
  const index = parseCheckpointIndex(out, [REF, other]);
  assert.deepEqual(index.get(SHA), [{ ref: REF, sessions: ["0", "1"] }]);
  assert.deepEqual(index.get("abc"), [{ ref: other, sessions: ["0"] }]);
});

test("parseCheckpointIndex skips a checkpoint whose ref it didn't ask for", () => {
  assert.equal(parseCheckpointIndex(top("UNKNOWN", SHA, ["0"]), [REF]).size, 0);
});

test("parseSessionMeta reads the agent, model, time and tokens of a session", () => {
  const session = parseSessionMeta(JSON.parse(SESSION));
  assert.deepEqual(session, {
    id: "11111111-2222-3333-4444-555555555555",
    source: "entire",
    confidence: "exact",
    agent: "Claude Code",
    model: "claude-opus-5-5",
    time: Math.floor(Date.parse("2026-11-20T03:49:58.216Z") / 1000),
    tokens: 12 + 351125 + 1748631 + 2534,
    prompt: null,
  });
});

test("parseSessionMeta drops a session without an id", () => {
  assert.equal(parseSessionMeta({ agent: "Claude Code" }), null);
});

test("checkpointFromMessage finds the Entire trailer", () => {
  assert.equal(checkpointFromMessage("fix: x\n\nEntire-Checkpoint: 01M7VH6HT8NZ61PS305PHFH71S\n"), "01M7VH6HT8NZ61PS305PHFH71S");
  assert.equal(checkpointFromMessage("fix: x"), null);
});

function fakeGit(answers: Record<string, string>, calls: string[][]): Git {
  return async (_target, args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    if (key === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
    return answers[key] ?? "";
  };
}

test("loadEntireIndex lists the refs, then reads every top-level metadata in one show", async () => {
  const calls: string[][] = [];
  const git = fakeGit({ "for-each-ref": `${REF}\n`, [`${REF}:metadata.json`]: top("01M7VH6HT8NZ61PS305PHFH71S", SHA, ["0"]) }, calls);
  const index = await loadEntireIndex(git, TARGET);
  assert.deepEqual(index.get(SHA), [{ ref: REF, sessions: ["0"] }]);
  assert.equal(calls.length, 2);
});

test("loadEntireIndex is empty when there are no checkpoints or git fails", async () => {
  assert.equal((await loadEntireIndex(fakeGit({ "for-each-ref": "" }, []), TARGET)).size, 0);
  assert.equal((await loadEntireIndex(async () => { throw new Error("no git"); }, TARGET)).size, 0);
});

test("entireSessions reads a commit's sessions and prompts, never full.jsonl", async () => {
  const calls: string[][] = [];
  const git = fakeGit({ [`${REF}:0/metadata.json`]: SESSION, [`${REF}:0/prompt.txt`]: "add a helper\n" }, calls);
  const index = new Map([[SHA, [{ ref: REF, sessions: ["0"] }]]]);
  const sessions = await entireSessions(git, TARGET, { hash: SHA, message: "x" }, index);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.model, "claude-opus-5-5");
  assert.equal(sessions[0]?.prompt, "add a helper");
  assert.ok(calls.every((c) => !c.join(" ").includes("full.jsonl")));
});

test("entireSessions follows the commit message's checkpoint when the index lacks the commit", async () => {
  const calls: string[][] = [];
  const git = fakeGit({
    "for-each-ref": `${REF}\n`,
    [`${REF}:metadata.json`]: top("01M7VH6HT8NZ61PS305PHFH71S", "other", ["0"]),
    [`${REF}:0/metadata.json`]: SESSION,
    [`${REF}:0/prompt.txt`]: "",
  }, calls);
  const message = "feat: y\n\nEntire-Checkpoint: 01M7VH6HT8NZ61PS305PHFH71S";
  const sessions = await entireSessions(git, TARGET, { hash: "fff", message }, new Map());
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.prompt, null);
});

test("entireSessions skips a session it can't read and keeps the others", async () => {
  const git = fakeGit({ [`${REF}:1/metadata.json`]: SESSION, [`${REF}:1/prompt.txt`]: "p" }, []);
  const index = new Map([[SHA, [{ ref: REF, sessions: ["0", "1"] }]]]);
  const sessions = await entireSessions(git, TARGET, { hash: SHA, message: "" }, index);
  assert.equal(sessions.length, 1);
});

test("entireSessions reads every session's metadata in one show, and prompts once per session", async () => {
  const calls: string[][] = [];
  const other = "refs/entire/checkpoints/03/01M7RRH23XA6WPP5HVC9FBE703";
  const later = SESSION.replace("2026-11-20T03:49:58.216Z", "2026-11-20T05:00:00.000Z");
  const git: Git = async (_t, args) => {
    calls.push(args);
    const specs = args.slice(2);
    if (specs.every((s) => s.endsWith("metadata.json"))) return specs.map((s) => (s.startsWith(other) ? later : SESSION)).join("\n");
    return specs[0]?.startsWith(other) ? "latest prompt" : "old prompt";
  };
  const index = new Map([[SHA, [{ ref: REF, sessions: ["0"] }, { ref: other, sessions: ["0"] }]]]);
  const sessions = await entireSessions(git, TARGET, { hash: SHA, message: "" }, index);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.prompt, "latest prompt");
  assert.equal(calls.length, 2);
});
