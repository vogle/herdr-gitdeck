import { test } from "node:test";
import assert from "node:assert/strict";
import { logArgs, parseLog, parseStashes, STASH_ARGS } from "../src/core/git/log.ts";
import { parseRefs, refsByCommit, REFS_ARGS } from "../src/core/git/refs.ts";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);

test("logArgs walks every branch, remote and tag in date order, limited", () => {
  const args = logArgs(300);
  for (const a of ["log", "--date-order", "--max-count=300", "--branches", "--remotes", "--tags", "HEAD"]) assert.ok(args.includes(a), a);
  assert.equal(args.at(-1), "--");
  assert.ok(!args.includes("--all"), "--all would pull in refs/stash");
  assert.ok(args.includes("--no-show-signature"), "log.showSignature would run the repo's gpg.program");
});

test("parseLog reads records split by RS, fields by US", () => {
  const out = `${H1}\x1f${H2} ${H3}\x1fAnn Lee\x1fann@x.io\x1f1700000000\x1fMerge: a | b\x1e\n${H2}\x1f\x1fBo\x1fbo@x.io\x1f1690000000\x1fRoot\x1e\n`;
  assert.deepEqual(parseLog(out), [
    { hash: H1, parents: [H2, H3], author: "Ann Lee", email: "ann@x.io", time: 1700000000, subject: "Merge: a | b" },
    { hash: H2, parents: [], author: "Bo", email: "bo@x.io", time: 1690000000, subject: "Root" },
  ]);
});

test("parseLog skips junk and empty output", () => {
  assert.deepEqual(parseLog(""), []);
  assert.deepEqual(parseLog("warning: something\x1e\n"), []);
  assert.equal(parseLog(`${H1}\x1f\x1fA\x1fa@x\x1fnope\x1fS\x1e`)[0]?.time, 0);
});

test("parseStashes reads hash, name and subject", () => {
  assert.ok(STASH_ARGS.includes("list"));
  const out = `${H1}\x1fstash@{0}\x1fWIP on main: abc\n${H2}\x1fstash@{1}\x1fOn dev: try\n\n`;
  assert.deepEqual(parseStashes(out), [
    { hash: H1, name: "stash@{0}", subject: "WIP on main: abc" },
    { hash: H2, name: "stash@{1}", subject: "On dev: try" },
  ]);
  assert.deepEqual(parseStashes("garbage\n"), []);
});

test("parseRefs reads branches with tracking, remotes without HEAD, peeled tags", () => {
  assert.equal(REFS_ARGS[0], "for-each-ref");
  const lines = [
    `refs/heads/main\x1f${H1}\x1f\x1forigin/main\x1fahead 2, behind 1\x1f*`,
    `refs/heads/dev\x1f${H2}\x1f\x1f\x1f\x1f `,
    `refs/heads/old\x1f${H2}\x1f\x1forigin/old\x1fgone\x1f `,
    `refs/remotes/origin/HEAD\x1f${H1}\x1f\x1f\x1f\x1f `,
    `refs/remotes/origin/main\x1f${H1}\x1f\x1f\x1f\x1f `,
    `refs/tags/v1\x1f${H3}\x1f${H2}\x1f\x1f\x1f `,
    `refs/tags/light\x1f${H3}\x1f\x1f\x1f\x1f `,
    `refs/notes/commits\x1f${H3}\x1f\x1f\x1f\x1f `,
    "",
  ].join("\n");
  const refs = parseRefs(lines);
  assert.deepEqual(
    refs.map((r) => [r.kind, r.name, r.hash.slice(0, 1), r.upstream, r.ahead, r.behind, r.current]),
    [
      ["branch", "main", "a", "origin/main", 2, 1, true],
      ["branch", "dev", "b", null, 0, 0, false],
      ["branch", "old", "b", "origin/old", 0, 0, false],
      ["remote", "origin/main", "a", null, 0, 0, false],
      ["tag", "v1", "b", null, 0, 0, false],
      ["tag", "light", "c", null, 0, 0, false],
    ],
  );
});

test("parseRefs ignores a ref with no object", () => {
  assert.deepEqual(parseRefs("refs/heads/x\x1f\x1f\x1f\x1f\x1f "), []);
});

test("refsByCommit groups by commit, current branch first, then branches, tags, remotes", () => {
  const refs = parseRefs(
    [
      `refs/remotes/origin/main\x1f${H1}\x1f\x1f\x1f\x1f `,
      `refs/tags/v1\x1f${H1}\x1f\x1f\x1f\x1f `,
      `refs/heads/dev\x1f${H1}\x1f\x1f\x1f\x1f `,
      `refs/heads/main\x1f${H1}\x1f\x1f\x1f\x1f*`,
      `refs/heads/other\x1f${H2}\x1f\x1f\x1f\x1f `,
    ].join("\n"),
  );
  const by = refsByCommit(refs);
  assert.deepEqual(by[H1]?.map((r) => r.name), ["main", "dev", "v1", "origin/main"]);
  assert.deepEqual(by[H2]?.map((r) => r.name), ["other"]);
  assert.equal(by[H3], undefined);
});
