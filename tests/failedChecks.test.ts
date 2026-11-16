import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNotes } from "../src/core/forge/failedChecks.ts";

const unit = { name: "test / unit", url: "https://git.acme.dev/g/app/-/jobs/501", log: "glab ci trace 501 --repo g/app" };
const rabbit = { name: "CodeRabbit", url: "https://coderabbit.ai/r/1", log: null };

test("each failed check becomes a note that says where to read why", () => {
  assert.deepEqual(checkNotes([unit, rabbit], []), [
    { where: "Failed check: test / unit", quote: [], text: "Read its log with `glab ci trace 501 --repo g/app` and fix what failed. Page: https://git.acme.dev/g/app/-/jobs/501" },
    { where: "Failed check: CodeRabbit", quote: [], text: "Read why at https://coderabbit.ai/r/1 and fix what failed." },
  ]);
  assert.deepEqual(checkNotes([{ name: "x", url: "", log: null }], [])[0]?.text, "Find out why it failed and fix it.");
});

test("a check already waiting in the batch isn't added twice; one sent before can be again", () => {
  const [note] = checkNotes([unit], []);
  assert.ok(note);
  assert.deepEqual(checkNotes([unit, rabbit], [{ ...note, state: "draft" }]).map((n) => n.where), ["Failed check: CodeRabbit"]);
  assert.deepEqual(checkNotes([unit], [{ ...note, state: "queued" }]), []);
  assert.equal(checkNotes([unit], [{ ...note, state: "sent" }]).length, 1, "it failed again after the agent had it");
});
