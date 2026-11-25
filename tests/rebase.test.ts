import { test } from "node:test";
import assert from "node:assert/strict";
import { planOf, squashPlan, squashBase, todoText, planProblem, rangeArgs, interactiveArgs, shellQuote } from "../src/core/rebase.ts";

const c = (n: string, parents = 1) => ({ hash: n.repeat(40), parents: Array(parents).fill("p".repeat(40)), author: "a", email: "", time: 0, subject: `s${n}` });

test("a plan starts as pick, oldest first", () => {
  const plan = planOf("b".repeat(40), [c("2"), c("1")]);
  assert.deepEqual(plan.steps.map((s) => [s.action, s.subject]), [["pick", "s1"], ["pick", "s2"]]);
});

test("squashPlan keeps the oldest as pick and folds every later commit into it", () => {
  const plan = planOf(null, [c("3"), c("2"), c("1")]);
  const squash = squashPlan(plan);
  assert.deepEqual(squash.steps.map((s) => s.action), ["pick", "fixup", "fixup"]);
  assert.equal(plan.steps[1]?.action, "pick", "the original is untouched");
  assert.equal(todoText(squash), `pick ${"1".repeat(40)} s1\nfixup ${"2".repeat(40)} s2\nfixup ${"3".repeat(40)} s3\n`);
});

test("squashBase: the parent of the chosen commit, or the root", () => {
  assert.equal(squashBase("a".repeat(40), 1), `${"a".repeat(40)}^`);
  assert.equal(squashBase("a".repeat(40), 0), null);
});

test("planProblem: merges, an empty plan, or a lone commit", () => {
  assert.match(planProblem(planOf(null, [c("1", 2)])) ?? "", /merge/);
  assert.match(planProblem(planOf(null, [])) ?? "", /Nothing/);
  assert.match(planProblem(squashPlan(planOf(null, [c("1")]))) ?? "", /Nothing/);
  assert.equal(planProblem(squashPlan(planOf(null, [c("2"), c("1")]))), null);
});

test("the range and the rebase command", () => {
  assert.deepEqual(rangeArgs("b".repeat(40)).slice(-2), [`${"b".repeat(40)}..HEAD`, "--"]);
  assert.deepEqual(rangeArgs(null).slice(-2), ["HEAD", "--"]);
  assert.equal(shellQuote("/a b/it's"), `'/a b/it'\\''s'`);
  assert.deepEqual(interactiveArgs("b".repeat(40), "/r/.git/t"), ["-c", "sequence.editor=cp '/r/.git/t'", "-c", "core.editor=true", "rebase", "-i", "b".repeat(40)]);
  assert.deepEqual(interactiveArgs(null, "/t").slice(-2), ["-i", "--root"]);
});
