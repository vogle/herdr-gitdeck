import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CODEX, codexFolder, codexSession, LIST_CODEX, readCodexLogs, SCAN_CODEX } from "../../src/core/agentLink/codexLog.ts";
import { guessSessions, parseListing, parseScan } from "../../src/core/agentLink/claudeLog.ts";
import type { Exec } from "../../src/core/git/runner.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/agentLink/codex-session.jsonl", import.meta.url));
const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

test("codexFolder and codexSession", () => {
  assert.equal(codexFolder("/Users/me"), "/Users/me/.codex/sessions");
  assert.equal(codexSession("/s/2026/11/21/rollout-2026-11-21T00-20-55-01a1fb7a-3b61-7cb1-899b-a8c0d949fc51.jsonl"), "01a1fb7a-3b61-7cb1-899b-a8c0d949fc51");
});

test("the Codex scan reads a repo's session: the files its commands named, with the model and branch", () => {
  const out = execFileSync("perl", ["-e", SCAN_CODEX, "0", FIXTURE, "/repo"], { encoding: "utf8" });
  const { named, edits, offset } = parseScan(out);
  assert.deepEqual(edits, []);
  // Other words that look like paths are read too; only the commit's files count later.
  const files = named.filter((n) => n.file === "a.txt" || n.file === "src/b.ts");
  assert.deepEqual(files.map((n) => [n.file, n.model, n.branch, n.time]), [
    ["a.txt", "", "master", at("2026-11-21T00:21:06.009Z")],
    ["src/b.ts", "gpt-5.6-luna", "master", at("2026-11-21T00:21:10.000Z")],
  ]);
  assert.ok(offset > 0);
});

test("the Codex scan stops at the first line of another repo's session", () => {
  const out = execFileSync("perl", ["-e", SCAN_CODEX, "0", FIXTURE, "/other", "/repo-two"], { encoding: "utf8" });
  const { named, offset } = parseScan(out);
  assert.deepEqual(named, []);
  // Read up to the end, so it isn't opened again until it grows.
  assert.ok(offset > 0);
});

test("the Codex listing walks the dated folders", () => {
  const dir = fileURLToPath(new URL("../fixtures/agentLink", import.meta.url));
  const listed = parseListing(execFileSync("perl", ["-e", LIST_CODEX, dir], { encoding: "utf8" }));
  assert.deepEqual(listed, []);
});

test("readCodexLogs passes the repo's folders to the scan and names sessions by their id", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (_c, args) => {
    calls.push(args);
    if (args[1] === LIST_CODEX) return { code: 0, stdout: "10\t1\t/s/rollout-x-01a1fb7a-3b61-7cb1-899b-a8c0d949fc51.jsonl\n", stderr: "" };
    return { code: 0, stdout: "B\tp1\t2026-11-21T00:21:06.009Z\tgpt\tmaster\tcat a.txt\nO\t10\n", stderr: "" };
  };
  const read = await readCodexLogs(exec, { cwd: "/repo", on: null }, "/home", ["/repo", "/wt"], new Map());
  assert.deepEqual(calls[0]?.slice(2), ["/home/.codex/sessions"]);
  assert.deepEqual(calls[1]?.slice(2), ["0", "/s/rollout-x-01a1fb7a-3b61-7cb1-899b-a8c0d949fc51.jsonl", "/repo", "/wt"]);
  const sessions = guessSessions(read.logs, { time: at("2026-11-21T00:30:00Z"), parentTime: 0, files: ["a.txt"], roots: ["/repo"], branch: null }, CODEX);
  assert.deepEqual(sessions.map((s) => [s.id, s.source, s.agent, s.named]), [["01a1fb7a-3b61-7cb1-899b-a8c0d949fc51", "codex", "Codex", 1]]);
});
