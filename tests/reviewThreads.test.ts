import { test } from "node:test";
import assert from "node:assert/strict";
import { discussionsArgs, parseDiscussions, parseThreads, threadNotes, threadsArgs } from "../src/core/forge/reviewThreads.ts";

test("gh reads the PR's review threads through GraphQL, on the repo's own host", () => {
  const args = threadsArgs("cli/cli", 7);
  assert.deepEqual(args.slice(0, 8), ["api", "graphql", "-F", "owner=cli", "-F", "name=cli", "-F", "n=7"]);
  assert.match(args[9] ?? "", /^query=.*reviewThreads.*isResolved/s);
  assert.deepEqual(threadsArgs("ghe.acme.dev/o/r", 3).slice(0, 4), ["api", "graphql", "--hostname", "ghe.acme.dev"]);
});

test("parseThreads keeps unresolved threads and reviews asking for changes", () => {
  const json = JSON.stringify({ data: { repository: { pullRequest: {
    reviewThreads: { nodes: [
      { isResolved: false, path: "src/a.ts", line: 42, originalLine: 40, comments: { nodes: [
        { author: { login: "bo" }, body: "Rename this.\n\nIt reads wrong.", url: "u1" },
        { author: { login: "cy" }, body: "Agreed", url: "u2" },
      ] } },
      { isResolved: true, path: "src/b.ts", line: 1, comments: { nodes: [{ author: { login: "bo" }, body: "done", url: "u3" }] } },
      { isResolved: false, path: "src/c.ts", line: null, originalLine: 9, comments: { nodes: [{ author: null, body: "outdated", url: "u4" }] } },
    ] },
    reviews: { nodes: [
      { state: "CHANGES_REQUESTED", body: "<!-- bot -->Please add tests.", url: "r1", author: { login: "dee" } },
      { state: "CHANGES_REQUESTED", body: "", url: "r2", author: { login: "dee" } },
      { state: "COMMENTED", body: "Nice", url: "r3", author: { login: "eve" } },
    ] },
  } } } });
  assert.deepEqual(parseThreads(json), [
    { path: "src/a.ts", line: 42, url: "u1", comments: [{ author: "bo", body: "Rename this.\n\nIt reads wrong." }, { author: "cy", body: "Agreed" }] },
    { path: "src/c.ts", line: 9, url: "u4", comments: [{ author: "ghost", body: "outdated" }] },
    { path: null, line: null, url: "r1", comments: [{ author: "dee", body: "Please add tests." }] },
  ]);
  assert.deepEqual(parseThreads("{}"), []);
});

test("GitLab: glab reads the MR's discussions; unresolved ones are kept", () => {
  assert.deepEqual(discussionsArgs("g/app", 9), ["api", "--hostname", "gitlab.com", "projects/g%2Fapp/merge_requests/9/discussions?per_page=100"]);
  assert.deepEqual(discussionsArgs("https://git.acme.dev/g/app", 9)[2], "git.acme.dev");
  const json = JSON.stringify([
    { id: "d1", notes: [
      { system: false, resolvable: true, resolved: false, body: "Use a map here", author: { username: "bo" }, position: { new_path: "src/a.ts", new_line: 12, old_path: "src/a.ts", old_line: 10 } },
      { system: false, resolvable: true, resolved: false, body: "+1", author: { username: "cy" } },
    ] },
    { id: "d2", notes: [{ system: false, resolvable: true, resolved: false, body: "Why this?", author: { username: "bo" }, position: { new_path: "src/b.ts", new_line: null, old_path: "src/b.ts", old_line: 4 } }] },
    { id: "d3", notes: [{ system: false, resolvable: true, resolved: true, body: "fixed", author: { username: "bo" } }] },
    { id: "d4", notes: [{ system: true, resolvable: false, body: "added 1 commit", author: { username: "bo" } }] },
    { id: "d5", notes: [{ system: false, resolvable: true, resolved: false, body: "Overall: split it", author: { username: "dee" } }] },
  ]);
  assert.deepEqual(parseDiscussions(json), [
    { path: "src/a.ts", line: 12, url: "", comments: [{ author: "bo", body: "Use a map here" }, { author: "cy", body: "+1" }] },
    { path: "src/b.ts", line: 4, url: "", comments: [{ author: "bo", body: "Why this?" }] },
    { path: null, line: null, url: "", comments: [{ author: "dee", body: "Overall: split it" }] },
  ]);
  assert.deepEqual(parseDiscussions("{}"), []);
});

test("each thread becomes a note quoting who said what, not added twice while it waits", () => {
  const thread = { path: "src/a.ts", line: 42, url: "u1", comments: [{ author: "bo", body: "Rename this.\n\nIt reads wrong." }, { author: "cy", body: "Agreed" }] };
  const general = { path: null, line: null, url: "", comments: [{ author: "dee", body: "Split it" }] };
  const notes = threadNotes([thread, general], "PR", []);
  assert.deepEqual(notes, [
    { where: "Review comment on src/a.ts:42", quote: ["@bo: Rename this.", "It reads wrong.", "@cy: Agreed"], text: "Do what it asks, or reply why not. Thread: u1" },
    { where: "Review comment on the PR", quote: ["@dee: Split it"], text: "Do what it asks, or reply why not." },
  ]);
  const long = { ...general, comments: [{ author: "x", body: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") }] };
  assert.deepEqual(threadNotes([long], "MR", [])[0]?.quote.slice(-2), ["line 7", "… 4 more lines"]);
  const [first] = notes;
  assert.ok(first);
  assert.deepEqual(threadNotes([thread, general], "PR", [{ ...first, state: "queued" }]).map((n) => n.where), ["Review comment on the PR"]);
});
