import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  claudeFolder,
  guessSessions,
  parseListing,
  parseScan,
  readClaudeLogs,
  LIST,
  SCAN,
  type SessionEdits,
} from "../../src/core/agentLink/claudeLog.ts";
import type { Exec } from "../../src/core/git/runner.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/agentLink/claude-session.jsonl", import.meta.url));
const ID = "aaaaaaaa-0000-0000-0000-000000000001";
const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

test("claudeFolder names a repo's Claude Code project folder", () => {
  assert.equal(claudeFolder("/Users/me", "/Volumes/Work/my.repo"), "/Users/me/.claude/projects/-Volumes-Work-my-repo");
});

test("the scan script reads each edit's tool id, time, model, branch and file, and where it stopped", () => {
  const out = execFileSync("perl", ["-e", SCAN, "0", FIXTURE], { encoding: "utf8" });
  const { edits, offset } = parseScan(out);
  assert.deepEqual(edits, [
    { tool: "toolu_A", time: at("2026-11-12T02:09:54.810Z"), model: "claude-opus-5-5", branch: "main", file: "/repo/src/x.ts" },
    { tool: "toolu_B", time: at("2026-11-12T02:10:30.000Z"), model: "claude-opus-5-5", branch: "main", file: "/repo/tests/x.test.ts" },
  ]);
  // A shell command only names the files it touches: a weaker sign.
  assert.deepEqual(parseScan(out).named.map((n) => n.file), ["src/y.ts", "/repo/src/z.ts"]);
  assert.ok(offset > 0);
  // From where it stopped, nothing new.
  assert.deepEqual(parseScan(execFileSync("perl", ["-e", SCAN, String(offset), FIXTURE], { encoding: "utf8" })).edits, []);
});

test("parseListing reads size, mtime and path of each log", () => {
  assert.deepEqual(parseListing("12\t1700\t/p/a.jsonl\nbad\n"), [{ size: 12, mtime: 1700, path: "/p/a.jsonl" }]);
});

const edit = (file: string, iso: string, tool = file) => ({ tool, time: at(iso), model: "claude-opus-5-5", branch: "main", file });

test("only a session of this repo that edited a commit file between the parent and the commit is a candidate (AC-5)", () => {
  const logs: SessionEdits = new Map([
    ["A", [edit("/repo/src/x.ts", "2026-11-12T02:10:00Z")]],
    ["B", [edit("/other/src/x.ts", "2026-11-12T02:10:00Z")]],
    ["C", [edit("/repo/src/x.ts", "2026-11-12T03:00:00Z")]],
  ]);
  const commit = { time: at("2026-11-12T02:30:00Z"), parentTime: at("2026-11-12T02:00:00Z"), files: ["src/x.ts"], roots: ["/repo"], branch: "main" };
  const sessions = guessSessions(logs, commit);
  assert.deepEqual(sessions, [{
    id: "A", source: "claude", confidence: "guess", agent: "Claude Code", model: "claude-opus-5-5",
    time: at("2026-11-12T02:10:00Z"), tokens: null, prompt: null, overlap: 1, named: 0,
  }]);
});

test("candidates are ranked by files in common, then by being on the commit's branch", () => {
  const logs: SessionEdits = new Map([
    ["one", [edit("/repo/a.ts", "2026-11-12T02:10:00Z")]],
    ["two", [edit("/wt/a.ts", "2026-11-12T02:10:00Z", "t1"), edit("/wt/b.ts", "2026-11-12T02:11:00Z", "t2")]],
    ["other-branch", [{ ...edit("/repo/a.ts", "2026-11-12T02:10:00Z"), branch: "x" }]],
  ]);
  const commit = { time: at("2026-11-12T02:30:00Z"), parentTime: 0, files: ["a.ts", "b.ts"], roots: ["/repo", "/wt"], branch: "main" };
  assert.deepEqual(guessSessions(logs, commit).map((s) => [s.id, s.overlap]), [["two", 2], ["one", 1], ["other-branch", 1]]);
});

test("readClaudeLogs scans a new log, then leaves an unchanged one alone and reads only what was added", async () => {
  const calls: string[][] = [];
  let size = 100;
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    if (args[1] === LIST) return { code: 0, stdout: `${size}\t1\t/f/${ID}.jsonl\n`, stderr: "" };
    const from = args[2];
    const out = from === "0" ? `E\ttoolu_A\t2026-11-12T02:09:54.810Z\tm\tmain\t/repo/x.ts\nO\t100\n` : `E\ttoolu_B\t2026-11-12T02:12:00.000Z\tm\tmain\t/repo/y.ts\nO\t150\n`;
    return { code: 0, stdout: out, stderr: "" };
  };
  const target = { cwd: "/repo", on: null };
  const first = await readClaudeLogs(exec, target, ["/f"], new Map());
  assert.equal(first.logs.get(ID)?.length, 1);
  const again = await readClaudeLogs(exec, target, ["/f"], first.cache);
  assert.equal(calls.filter((c) => c[2] === SCAN).length, 1);
  assert.equal(again.logs.get(ID)?.length, 1);
  size = 150;
  const grown = await readClaudeLogs(exec, target, ["/f"], again.cache);
  assert.deepEqual(calls.at(-1)?.slice(3), ["100", `/f/${ID}.jsonl`]);
  assert.deepEqual(grown.logs.get(ID)?.map((e) => e.tool), ["toolu_A", "toolu_B"]);
});

test("readClaudeLogs is empty when perl fails or no folder exists", async () => {
  const exec: Exec = async () => ({ code: 1, stdout: "", stderr: "no perl" });
  assert.equal((await readClaudeLogs(exec, { cwd: "/r", on: null }, ["/f"], new Map())).logs.size, 0);
  const throws: Exec = async () => { throw new Error("x"); };
  assert.equal((await readClaudeLogs(throws, { cwd: "/r", on: null }, ["/f"], new Map())).logs.size, 0);
});

test("a file a shell command named counts, below one an edit tool wrote", () => {
  const named = (file: string, tool: string) => ({ ...edit(file, "2026-11-12T02:10:00Z", tool), named: true });
  const logs: SessionEdits = new Map([
    ["shell", [named("src/a.ts", "s1"), named("./src/b.ts", "s2"), named("/repo/src/c.ts", "s3"), named("notes/src/a.ts.bak", "s4")]],
    ["tool", [edit("/repo/src/a.ts", "2026-11-12T02:10:00Z")]],
  ]);
  const commit = { time: at("2026-11-12T02:30:00Z"), parentTime: 0, files: ["src/a.ts", "src/b.ts", "src/c.ts"], roots: ["/repo"], branch: null };
  assert.deepEqual(guessSessions(logs, commit).map((s) => [s.id, s.overlap, s.named]), [["tool", 1, 0], ["shell", 0, 3]]);
});

test("pathTokens keeps the words of a command that look like paths", async () => {
  const { pathTokens } = await import("../../src/core/agentLink/claudeLog.ts");
  assert.deepEqual(pathTokens(`cat > src/y.ts <<'EOF'\\nx\\nEOF && sed -n 1,5p "./a/b.md" README.md -v`), ["src/y.ts", "./a/b.md", "README.md"]);
});

test("a command logged in the parent's second counts: one command can make both commits", () => {
  const logs: SessionEdits = new Map([["s", [{ ...edit("package.json", "2026-11-12T02:00:00.041Z"), named: true as const }]]]);
  const commit = { time: at("2026-11-12T02:00:08Z"), parentTime: at("2026-11-12T02:00:00Z"), files: ["package.json"], roots: ["/repo"], branch: null };
  assert.equal(guessSessions(logs, commit).length, 1);
});
