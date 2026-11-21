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
