import { test } from "node:test";
import assert from "node:assert/strict";
import { herdAgents, reposShown } from "../src/core/repoAgents.ts";

const agent = (pane: string, status: "working" | "blocked" | "done" | "idle", name = "Claude") => ({ pane, status, program: { name, key: name.toLowerCase() } });
const pane = (id: string, cwd: string | null) => ({ pane: id, cwd });
const REPOS = ["/w", "/w/app", "/w/app/lib", "/w/site"];

test("each agent belongs to the deepest repo its terminal is in", () => {
  const by = herdAgents(REPOS, [agent("p1", "working"), agent("p2", "idle", "Codex"), agent("p3", "blocked")], [
    pane("p1", "/w/app/lib/src"),
    pane("p2", "/w/app"),
    pane("p3", "/w/notes"),
  ]);
  assert.deepEqual(Object.keys(by).sort(), ["/w", "/w/app", "/w/app/lib"]);
  assert.deepEqual(by["/w/app/lib"]?.map((a) => a.text), ["Claude working"]);
  assert.deepEqual(by["/w/app"]?.map((a) => a.text), ["Codex idle"]);
  assert.deepEqual(by["/w"]?.map((a) => a.text), ["Claude needs you"], "a folder that is no repo of its own falls to the one above");
});

test("a terminal outside every repo, or with no folder, counts nowhere", () => {
  assert.deepEqual(herdAgents(REPOS, [agent("p1", "working"), agent("p2", "working")], [pane("p1", "/tmp"), pane("p2", null)]), {});
  assert.deepEqual(herdAgents(REPOS, [agent("gone", "working")], []), {});
});

test("the agents-only filter keeps the repos with agents, and the shown one", () => {
  const by = herdAgents(REPOS, [agent("p1", "working")], [pane("p1", "/w/site")]);
  const repos = REPOS.map((path) => ({ path }));
  assert.deepEqual(reposShown(repos, by, false, "/w/app").map((r) => r.path), REPOS, "off: every repo");
  assert.deepEqual(reposShown(repos, by, true, "/w/app").map((r) => r.path), ["/w/app", "/w/site"]);
  assert.deepEqual(reposShown(repos, {}, true, null), []);
});
