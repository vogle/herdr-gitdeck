import { test } from "node:test";
import assert from "node:assert/strict";
import { planOf, cycleStep, moveStep, todoText, planProblem, rangeArgs, interactiveArgs, shellQuote } from "../src/core/rebase.ts";

const c = (n: string, parents = 1) => ({ hash: n.repeat(40), parents: Array(parents).fill("p".repeat(40)), author: "a", email: "", time: 0, subject: `s${n}` });

test("a plan starts as pick, oldest first", () => {
  const plan = planOf("b".repeat(40), [c("2"), c("1")]);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.subject]), [["pick", "s1"], ["pick", "s2"]]);
});

test("steps cycle pick → squash → fixup → drop, and move without mutating", () => {
  const plan = planOf(null, [c("2"), c("1")]);
  const cycled = cycleStep(cycleStep(plan, 1), 1);
  assert.equal(cycled.steps[1]?.action, "fixup");
  assert.equal(plan.steps[1]?.action, "pick", "the original is untouched");
  assert.equal(cycleStep(cycleStep(cycled, 1), 1).steps[1]?.action, "pick");
  assert.deepEqual(moveStep(plan, 1, -1).steps.map((s) => s.subject), ["s2", "s1"]);
  assert.equal(moveStep(plan, 0, -1), plan, "can't move past the top");
});

test("todoText writes git's todo list; dropped commits are left out", () => {
  let plan = planOf(null, [c("3"), c("2"), c("1")]);
  plan = cycleStep(plan, 1); // squash s2
  plan = cycleStep(cycleStep(cycleStep(plan, 2), 2), 2); // drop s3
  assert.equal(todoText(plan), `pick ${"1".repeat(40)} s1\nsquash ${"2".repeat(40)} s2\n`);
});

test("planProblem: merges, an empty plan, or squashing into nothing", () => {
  assert.match(planProblem(planOf(null, [c("1", 2)])) ?? "", /merge/);
  assert.match(planProblem(planOf(null, [])) ?? "", /Nothing/);
  assert.match(planProblem(cycleStep(planOf(null, [c("1")]), 0)) ?? "", /first/);
  assert.equal(planProblem(planOf(null, [c("1")])), null);
});

test("the range and the rebase command", () => {
  assert.deepEqual(rangeArgs("b".repeat(40)).slice(-2), [`${"b".repeat(40)}..HEAD`, "--"]);
  assert.deepEqual(rangeArgs(null).slice(-2), ["HEAD", "--"]);
  assert.equal(shellQuote("/a b/it's"), `'/a b/it'\\''s'`);
  assert.deepEqual(interactiveArgs("b".repeat(40), "/r/.git/t"), ["-c", "sequence.editor=cp '/r/.git/t'", "-c", "core.editor=true", "rebase", "-i", "b".repeat(40)]);
  assert.deepEqual(interactiveArgs(null, "/t").slice(-2), ["-i", "--root"]);
});
