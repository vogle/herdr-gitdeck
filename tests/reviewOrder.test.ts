import { test } from "node:test";
import assert from "node:assert/strict";
import { groupReview, reviewGroup, reviewOrder } from "../src/core/reviewOrder.ts";

test("a file's review group: code, tests, or the rest", () => {
  assert.equal(reviewGroup("src/core/panel.ts"), "code");
  assert.equal(reviewGroup("scripts/dev-install.sh"), "code");
  assert.equal(reviewGroup("tests/panel.test.ts"), "tests");
  assert.equal(reviewGroup("src/__tests__/a.ts"), "tests");
  assert.equal(reviewGroup("pkg/a_test.go"), "tests");
  assert.equal(reviewGroup("web/button.spec.tsx"), "tests");
  assert.equal(reviewGroup("mod/icons/file.svg"), "other");
  assert.equal(reviewGroup("README.md"), "other");
  assert.equal(reviewGroup("pnpm-lock.yaml"), "other");
});

const f = (path: string, added: number, deleted = 0) => ({ path, added, deleted });

test("groups come code first, most changed first inside, empty groups left out", () => {
  const groups = groupReview([f("mod/icons/a.svg", 1), f("src/b.ts", 3), f("src/a.ts", 80, 20), f("README.md", 5), f("src/c.ts", 3)]);
  assert.deepEqual(groups.map((g) => g.group), ["code", "other"]);
  assert.deepEqual(groups[0]?.files.map((x) => x.path), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.deepEqual(groups[1]?.files.map((x) => x.path), ["README.md", "mod/icons/a.svg"]);
});

test("the review order is the groups read top to bottom", () => {
  const order = reviewOrder([f("tests/a.test.ts", 9), f("logo.png", 1), f("src/a.ts", 1)]);
  assert.deepEqual(order.map((x) => x.path), ["src/a.ts", "tests/a.test.ts", "logo.png"]);
});
