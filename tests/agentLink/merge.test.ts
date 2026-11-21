import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSessions } from "../../src/core/agentLink/merge.ts";
import type { AgentSession } from "../../src/core/agentLink/types.ts";

const session = (id: string, source: AgentSession["source"]): AgentSession => ({
  id, source, confidence: source === "entire" || source === "git-ai" ? "exact" : "guess",
  agent: "Claude Code", model: null, time: 0, tokens: null, prompt: null,
});

test("mergeSessions keeps one session per id, from the first source that has it", () => {
  const merged = mergeSessions([[session("a", "entire")], [session("a", "git-ai"), session("b", "git-ai")], [session("b", "claude")]]);
  assert.deepEqual(merged.map((s) => [s.id, s.source]), [["a", "entire"], ["b", "git-ai"]]);
});

test("mergeSessions of nothing is nothing", () => {
  assert.deepEqual(mergeSessions([]), []);
});

test("mergeSessions keeps the first session but takes the line count a later source knows", () => {
  const merged = mergeSessions([[session("a", "entire")], [{ ...session("a", "git-ai"), lines: 12 }]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.source, "entire");
  assert.equal(merged[0]?.lines, 12);
});

test("orNone: a source that fails gives no sessions, so the others still show (REQ-6)", async () => {
  const { orNone } = await import("../../src/core/agentLink/merge.ts");
  assert.deepEqual(await orNone(Promise.reject(new Error("timed out"))), []);
  assert.deepEqual(await orNone(Promise.resolve([session("a", "claude")])).then((s) => s.map((x) => x.id)), ["a"]);
});

test("agentLinkOn: on unless gitdeck.agentLink is off", async () => {
  const { agentLinkOn } = await import("../../src/core/agentLink/merge.ts");
  assert.equal(agentLinkOn(undefined), true);
  assert.equal(agentLinkOn("on"), true);
  assert.equal(agentLinkOn("off"), false);
  assert.equal(agentLinkOn(false), false);
});
