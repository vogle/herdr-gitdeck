import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backStep, findViewerTab, isWide, viewerFocused, parseViewer, viewerBack, viewerKey, viewerShow, viewerTitle, WIDE_PX,
  type ViewerRequest,
} from "../src/core/panel.ts";

const diff: ViewerRequest = {
  view: "diff", repo: "/r", on: null,
  source: { kind: "commit", hash: "h2", parents: ["h1"], path: "a/b.ts", oldPath: null },
};
const blame: ViewerRequest = { view: "blame", repo: "/r", on: null, rev: "h2", path: "a/b.ts" };

test("the panel turns two-column at the wide breakpoint", () => {
  assert.equal(isWide(WIDE_PX - 1), false);
  assert.equal(isWide(WIDE_PX), true);
  assert.equal(isWide(368), false);
});

test("back closes the innermost level first", () => {
  assert.equal(backStep({ inspect: true, file: "x", selected: "h" }), "inspect");
  assert.equal(backStep({ inspect: false, file: "x", selected: "h" }), "file");
  assert.equal(backStep({ inspect: false, file: null, selected: "h" }), "commit");
  assert.equal(backStep({ inspect: false, file: null, selected: null }), null);
});

test("parseViewer accepts every well-formed request", () => {
  assert.deepEqual(parseViewer(diff), diff);
  assert.deepEqual(parseViewer(blame), blame);
  const log = { view: "file-log", repo: "/r", on: "m1", rev: "h", path: "p" };
  assert.deepEqual(parseViewer(log), log);
  assert.deepEqual(parseViewer({ view: "stats", repo: "/r", on: null }), { view: "stats", repo: "/r", on: null });
  const wt = { view: "diff", repo: "/r", on: null, source: { kind: "worktree", path: "p", hasHead: true } };
  assert.deepEqual(parseViewer(wt), wt);
  const un = { view: "diff", repo: "/r", on: null, source: { kind: "untracked", path: "p" } };
  assert.deepEqual(parseViewer(un), un);
});

test("parseViewer rejects anything malformed", () => {
  for (const bad of [
    null, 3, "diff", {}, { view: "nope", repo: "/r", on: null },
    { view: "stats", repo: "", on: null },
    { view: "stats", repo: "relative", on: null },
    { view: "stats", repo: "/r", on: 4 },
    { view: "blame", repo: "/r", on: null, rev: "h" },
    { view: "blame", repo: "/r", on: null, rev: "", path: "p" },
    { view: "diff", repo: "/r", on: null },
    { view: "diff", repo: "/r", on: null, source: { kind: "commit", hash: "h", parents: [1], path: "p", oldPath: null } },
    { view: "diff", repo: "/r", on: null, source: { kind: "commit", hash: "h", parents: [], path: "p", oldPath: 2 } },
    { view: "diff", repo: "/r", on: null, source: { kind: "worktree", path: "p" } },
    { view: "diff", repo: "/r", on: null, source: { kind: "other", path: "p" } },
  ]) assert.equal(parseViewer(bad), null, JSON.stringify(bad));
});

test("parseViewer keeps only the known fields", () => {
  const extra = { ...blame, junk: 1 } as unknown;
  assert.deepEqual(parseViewer(extra), blame);
});

test("viewerTitle names what is shown", () => {
  assert.equal(viewerTitle(diff), "b.ts");
  assert.equal(viewerTitle(blame), "Blame b.ts");
  assert.equal(viewerTitle({ view: "file-log", repo: "/r", on: null, rev: "h", path: "b.ts" }), "History b.ts");
  assert.equal(viewerTitle({ view: "stats", repo: "/x/proj", on: null }), "Stats proj");
});

test("viewerKey is the same for equal requests", () => {
  assert.equal(viewerKey(diff), viewerKey(JSON.parse(JSON.stringify(diff))));
  assert.notEqual(viewerKey(diff), viewerKey(blame));
  assert.equal(viewerKey(null), "");
});

test("a request from the panel replaces the viewer; one from inside it can go back", () => {
  const start = viewerShow({ current: null, back: [] }, diff, false);
  assert.deepEqual(start, { current: diff, back: [] });
  const inner = viewerShow(start, blame, true);
  assert.deepEqual(inner, { current: blame, back: [diff] });
  assert.deepEqual(viewerBack(inner), { current: diff, back: [] });
  const outside = viewerShow(inner, diff, false);
  assert.deepEqual(outside.back, []);
  assert.equal(viewerBack(start), start);
});

test("findViewerTab finds the tab of a githerd pane", () => {
  const panes = [{ mod: "files", tab: "t1" }, { tab: "t2" }, { mod: "githerd", tab: "t3" }];
  assert.equal(findViewerTab(panes), "t3");
  assert.equal(findViewerTab([{ mod: "files", tab: "t1" }]), null);
});

test("viewerFocused: focus in the viewer's tab keeps the panel on its repo", () => {
  const panes = [{ mod: "githerd", tab: "t3" }, { tab: "t1" }];
  assert.equal(viewerFocused({ tab: "t3" }, panes), true);
  assert.equal(viewerFocused({ tab: "t1" }, panes), false);
  assert.equal(viewerFocused(null, panes), false);
});
