import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, summarize, STATUS_ARGS, NEW_FOLDERS_ARGS, parseNewFolders } from "../src/core/git/status.ts";

const z = (...records: string[]) => records.join("\0") + "\0";

test("STATUS_ARGS asks for porcelain v2 with branch, stash and NUL separators", () => {
  for (const flag of ["--porcelain=v2", "--branch", "--show-stash", "-z"]) assert.ok(STATUS_ARGS.includes(flag), flag);
});

test("STATUS_ARGS lists each untracked file, not just its new folder", () => {
  assert.ok(STATUS_ARGS.includes("--untracked-files=all"));
});

test("STATUS_ARGS never recurses into submodules (their own config could run programs)", () => {
  assert.ok(STATUS_ARGS.includes("--ignore-submodules=all"));
});

test("parses branch headers, upstream and ahead/behind", () => {
  const s = parseStatus(
    z("# branch.oid 1234abcd", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +3 -2", "# stash 4"),
  );
  assert.equal(s.oid, "1234abcd");
  assert.equal(s.branch, "main");
  assert.equal(s.upstream, "origin/main");
  assert.equal(s.ahead, 3);
  assert.equal(s.behind, 2);
  assert.equal(s.stash, 4);
  assert.deepEqual(s.entries, []);
});

test("an initial commit and a detached head have no oid / branch", () => {
  const s = parseStatus(z("# branch.oid (initial)", "# branch.head (detached)"));
  assert.equal(s.oid, null);
  assert.equal(s.branch, null);
  assert.equal(s.upstream, null);
  assert.equal(s.ahead, 0);
  assert.equal(s.behind, 0);
  assert.equal(s.stash, 0);
});

test("parses changed, renamed, conflicted, untracked and ignored entries, paths with spaces kept", () => {
  const s = parseStatus(
    z(
      "1 M. N... 100644 100644 100644 aaa bbb src/a file.ts",
      "1 .M N... 100644 100644 100644 aaa bbb b.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts",
      "old name.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc both.ts",
      "? new dir/x.ts",
      "! dist/",
    ),
  );
  assert.deepEqual(s.entries, [
    { kind: "changed", index: "M", worktree: ".", path: "src/a file.ts", origPath: null },
    { kind: "changed", index: ".", worktree: "M", path: "b.ts", origPath: null },
    { kind: "renamed", index: "R", worktree: ".", path: "new name.ts", origPath: "old name.ts" },
    { kind: "conflict", index: "U", worktree: "U", path: "both.ts", origPath: null },
    { kind: "untracked", index: "?", worktree: "?", path: "new dir/x.ts", origPath: null },
    { kind: "ignored", index: "!", worktree: "!", path: "dist/", origPath: null },
  ]);
});

test("ignores empty and unknown records", () => {
  const s = parseStatus("\0\0x what\0# something.else 1\0");
  assert.deepEqual(s.entries, []);
  assert.equal(s.branch, null);
});

test("summarize counts staged, unstaged, untracked and conflicts (a file can be both staged and unstaged)", () => {
  const s = parseStatus(
    z(
      "1 MM N... 100644 100644 100644 aaa bbb both.ts",
      "1 A. N... 000000 100644 100644 aaa bbb added.ts",
      "1 .D N... 100644 100644 000000 aaa bbb gone.ts",
      "u AA N... 100644 100644 100644 100644 aaa bbb ccc c.ts",
      "? u1",
      "? u2",
      "! ignored",
    ),
  );
  assert.deepEqual(summarize(s), { staged: 2, unstaged: 2, untracked: 2, conflicts: 1, clean: false });
});

test("summarize of a clean repo", () => {
  assert.deepEqual(summarize(parseStatus(z("# branch.head main"))), {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    clean: true,
  });
});

test("NEW_FOLDERS_ARGS asks for untracked folders as one entry each", () => {
  for (const flag of ["ls-files", "--others", "--exclude-standard", "--directory", "-z"]) assert.ok(NEW_FOLDERS_ARGS.includes(flag), flag);
});

test("parseNewFolders keeps the folders, not the loose files", () => {
  assert.deepEqual(parseNewFolders(".claude/\0b.txt\0c/d/\0"), [".claude/", "c/d/"]);
  assert.deepEqual(parseNewFolders(""), []);
});
