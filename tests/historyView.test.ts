import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyView, forRepo, withHistory, rebuild, selectCommit, withCommit, openFile, withDiff, closeFile,
  setQuery, toggleSidebar, showMore, jumpTo, PAGE,
} from "../src/core/historyView.ts";
import { EMPTY_HISTORY, UNCOMMITTED, type History } from "../src/core/history.ts";
import type { Commit } from "../src/core/git/log.ts";

const c = (hash: string, subject: string, ...parents: string[]): Commit => ({ hash, parents, author: "Ann", email: "a@x", time: 0, subject });
const HIST: History = { ...EMPTY_HISTORY, commits: [c("h2", "Add graph", "h1"), c("h1", "Initial")] };
const view = () => withHistory(forRepo(emptyView(), "/r"), "/r", HIST);

test("forRepo starts over for another repo and keeps the view for the same one", () => {
  const v = selectCommit(view(), "h1");
  assert.equal(forRepo(v, "/r"), v);
  const other = forRepo(v, "/other");
  assert.equal(other.repo, "/other");
  assert.equal(other.history, null);
  assert.equal(other.selected, null);
  assert.equal(other.sidebar, v.sidebar);
});

test("withHistory ignores a history for a repo no longer shown", () => {
  const v = forRepo(emptyView(), "/r");
  assert.equal(withHistory(v, "/old", HIST), v);
});

test("withHistory builds the graph rows and drops a selection that is gone", () => {
  const v = view();
  assert.deepEqual(v.rows.map((r) => r.hash), ["h2", "h1"]);
  assert.equal(v.lanes.rows.length, 2);
  const gone = withHistory(selectCommit(v, "zz"), "/r", HIST);
  assert.equal(gone.selected, null);
  const kept = withHistory(selectCommit(v, "h1"), "/r", HIST);
  assert.equal(kept.selected, "h1");
});

test("rebuild adds the uncommitted row above HEAD, and removes it once clean", () => {
  const v = rebuild(view(), "h2", 2);
  assert.deepEqual(v.rows.map((r) => r.hash), [UNCOMMITTED, "h2", "h1"]);
  assert.equal(v.lanes.rows[0]?.segments[0]?.dashed, true);
  const selected = selectCommit(v, UNCOMMITTED);
  const clean = rebuild(selected, "h2", 0);
  assert.deepEqual(clean.rows.map((r) => r.hash), ["h2", "h1"]);
  assert.equal(clean.selected, null);
  assert.equal(rebuild(clean, "h2", 0).rows, clean.rows, "unchanged input keeps the same rows");
});

test("a query keeps only the matching rows, and blank shows all again", () => {
  const v = setQuery(view(), "graph");
  assert.deepEqual(v.rows.map((r) => r.hash), ["h2"]);
  assert.equal(v.searching, true);
  const back = setQuery(v, "");
  assert.deepEqual(back.rows.map((r) => r.hash), ["h2", "h1"]);
  assert.equal(back.searching, false);
});

test("selectCommit toggles, and clears the commit's details and diff", () => {
  const v = withDiff(openFile(withCommit(selectCommit(view(), "h2"), "h2", { detail: null, files: [], error: null }), "a"), "a", { rows: [], truncated: false });
  assert.equal(v.selected, "h2");
  assert.ok(v.commit);
  assert.ok(v.diff);
  const off = selectCommit(v, "h2");
  assert.equal(off.selected, null);
  assert.equal(off.commit, null);
  assert.equal(off.file, null);
  const other = selectCommit(v, "h1");
  assert.equal(other.selected, "h1");
  assert.equal(other.commit, null);
  assert.equal(other.diff, null);
});

test("late answers for another commit or file are ignored", () => {
  const v = selectCommit(view(), "h2");
  assert.equal(withCommit(v, "h1", { detail: null, files: [], error: null }), v);
  const f = openFile(v, "a");
  assert.equal(withDiff(f, "b", { rows: [], truncated: false }), f);
  assert.equal(closeFile(f).file, null);
});

test("sidebar, paging and jumping to a ref", () => {
  const v = view();
  assert.equal(toggleSidebar(toggleSidebar(v)).sidebar, v.sidebar);
  assert.equal(showMore(v).limit, v.limit + PAGE);
  const j = jumpTo(setQuery(v, "zzz"), "h1");
  assert.equal(j.selected, "h1");
  assert.equal(j.query, "", "jumping clears the search so the commit is visible");
  assert.equal(j.scrollTo, 1);
  assert.equal(jumpTo(v, "nope"), v);
});
