import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbor, parseBlobs, parseQueue, seenFor, viewState, viewedCount, withViewed } from "../src/core/reviewed.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const Z = "0".repeat(40);

test("parseBlobs reads each file's blob after the change from raw diff-tree output", () => {
  const raw = [
    `:100644 100644 ${A} ${B} M`, "src/a.ts",
    `:000000 100644 ${Z} ${A} A`, "new.ts",
    `:100644 000000 ${B} ${Z} D`, "gone.ts",
    `:100644 100644 ${A} ${B} R090`, "old.ts", "renamed.ts",
    "",
  ].join("\0");
  const blobs = parseBlobs(raw);
  assert.equal(blobs.get("src/a.ts"), B);
  assert.equal(blobs.get("new.ts"), A);
  assert.equal(blobs.get("gone.ts"), `deleted:${B}`);
  assert.equal(blobs.get("renamed.ts"), B);
  assert.equal(blobs.has("old.ts"), false);
  assert.equal(parseBlobs("").size, 0);
});

test("seenFor reads one repo's viewed files, dropping anything malformed", () => {
  assert.deepEqual(seenFor({ "/r": { "a.ts": A, bad: 3 } }, "/r"), { "a.ts": A });
  assert.deepEqual(seenFor({ "/r": { "a.ts": A } }, "/other"), {});
  assert.deepEqual(seenFor("junk", "/r"), {});
  assert.deepEqual(seenFor({ "/r": [] }, "/r"), {});
});

test("a file is viewed while its blob is the one seen, changed once it moves on", () => {
  const seen = { "a.ts": A };
  assert.equal(viewState(seen, "a.ts", A), "viewed");
  assert.equal(viewState(seen, "a.ts", B), "changed");
  assert.equal(viewState(seen, "b.ts", A), "unseen");
  assert.equal(viewState(seen, "a.ts", undefined), "viewed", "no blob known: the mark stands");
});

test("withViewed marks and unmarks without touching other repos, and keeps only current files", () => {
  const all = { "/x": { "k.ts": A }, "/r": { "old.ts": A } };
  const marked = withViewed(all, "/r", "a.ts", B, true, ["a.ts", "b.ts"]);
  assert.deepEqual(marked, { "/x": { "k.ts": A }, "/r": { "a.ts": B } });
  assert.deepEqual(all["/r"], { "old.ts": A }, "the old value is left as it was");
  assert.deepEqual(withViewed(marked, "/r", "a.ts", B, false, ["a.ts"]), { "/x": { "k.ts": A }, "/r": {} });
  assert.deepEqual(withViewed("junk", "/r", "a.ts", "", true, ["a.ts"]), { "/r": { "a.ts": "" } });
});

test("viewedCount counts files still viewed as they are now", () => {
  const blobs = new Map([["a.ts", A], ["b.ts", B], ["c.ts", A]]);
  assert.equal(viewedCount(["a.ts", "b.ts", "c.ts"], { "a.ts": A, "b.ts": A }, blobs), 1);
});

const queue = {
  repo: "/r", on: null, head: B, mergeBase: A,
  files: [{ path: "a.ts", oldPath: null, blob: A }, { path: "b.ts", oldPath: "x.ts", blob: B }],
};

test("parseQueue takes a well-formed review queue and refuses others", () => {
  assert.deepEqual(parseQueue(queue), queue);
  assert.equal(parseQueue({ ...queue, repo: "rel" }), null);
  assert.equal(parseQueue({ ...queue, files: [{ path: "" }] }), null);
  assert.equal(parseQueue({ ...queue, head: 3 }), null);
  assert.equal(parseQueue(null), null);
});

test("neighbor steps through the queue and stops at the ends", () => {
  assert.equal(neighbor(queue, "a.ts", 1)?.path, "b.ts");
  assert.equal(neighbor(queue, "b.ts", -1)?.path, "a.ts");
  assert.equal(neighbor(queue, "b.ts", 1), null);
  assert.equal(neighbor(queue, "a.ts", -1), null);
  assert.equal(neighbor(queue, "zzz.ts", 1), null);
});
