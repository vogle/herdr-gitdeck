import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConflicts, resolveText, conflictCount, choose, allChosen, resolveFile } from "../src/core/conflict.ts";

const text = ["a", "<<<<<<< HEAD", "ours1", "ours2", "=======", "theirs", ">>>>>>> side", "b", "<<<<<<< HEAD", "x", "||||||| base", "o", "=======", "y", ">>>>>>> side", ""].join("\n");

test("parseConflicts splits text and conflicts, reading diff3 bases too", () => {
  const segs = parseConflicts(text);
  assert.equal(conflictCount(segs), 2);
  assert.deepEqual(segs[1], { kind: "conflict", ours: ["ours1", "ours2"], theirs: ["theirs"], oursLabel: "HEAD", theirsLabel: "side", choice: null });
  assert.deepEqual(segs[3], { kind: "conflict", ours: ["x"], theirs: ["y"], oursLabel: "HEAD", theirsLabel: "side", choice: null });
});

test("each conflict takes ours, theirs or both; the text is rebuilt, nothing mutated", () => {
  const segs = parseConflicts(text);
  const chosen = choose(choose(segs, 0, "both"), 1, "theirs");
  assert.equal(segs[1]?.kind === "conflict" && segs[1].choice, null);
  assert.ok(allChosen(chosen));
  assert.ok(!allChosen(choose(segs, 0, "ours")));
  assert.equal(resolveText(chosen), ["a", "ours1", "ours2", "theirs", "b", "y", ""].join("\n"));
});

test("an unfinished marker stays text; a file without markers has none", () => {
  assert.equal(conflictCount(parseConflicts("<<<<<<< HEAD\nx\n")), 0);
  assert.equal(resolveText(parseConflicts("<<<<<<< HEAD\nx\n")), "<<<<<<< HEAD\nx\n");
  assert.equal(conflictCount(parseConflicts("plain\n")), 0);
});

test("resolveFile writes only when every conflict is chosen and the file is unchanged, then stages it", async () => {
  const at = { cwd: "/r", on: null };
  const writes: [string, string, string | null][] = [];
  const files = { read: async () => text, write: async (p: string, t: string, e: string | null) => { writes.push([p, t, e]); return null; }, remove: async () => null };
  const staged: string[][] = [];
  const git = async (_t: unknown, args: string[]) => { staged.push(args); return ""; };
  const segs = parseConflicts(text);
  assert.match((await resolveFile(git, files, at, "f", text, segs)) ?? "", /Choose/);
  const done = choose(choose(segs, 0, "ours"), 1, "ours");
  assert.equal(await resolveFile(git, files, at, "f", text, done), null);
  assert.deepEqual(writes[0], ["/r/f", "a\nours1\nours2\nb\nx\n", text]);
  assert.equal(staged[0]?.[0], "add");
  assert.match((await resolveFile(git, files, { cwd: "/r", on: "box" }, "f", text, done)) ?? "", /this machine/);
  const failing = { ...files, write: async () => { throw new Error("changed on disk"); } };
  assert.equal(await resolveFile(git, failing, at, "f", text, done), "changed on disk");
});
