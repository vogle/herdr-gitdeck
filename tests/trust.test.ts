import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTER_CHECK_ARGS, repoFilterCommands } from "../src/core/git/trust.ts";

test("FILTER_CHECK_ARGS reads filter commands with each one's scope", () => {
  assert.deepEqual(FILTER_CHECK_ARGS.slice(0, 3), ["config", "--show-scope", "--get-regexp"]);
  const pattern = new RegExp(FILTER_CHECK_ARGS[3] ?? "");
  for (const key of ["filter.evil.clean", "filter.a.b.smudge", "filter.x.process"]) assert.ok(pattern.test(key), key);
  for (const key of ["filter.lfs.required", "diff.x.textconv", "myfilter.x.clean"]) assert.ok(!pattern.test(key), key);
});

test("repoFilterCommands keeps the repo's own (local, worktree) filter commands only", () => {
  const out = [
    "global\tfilter.lfs.clean git-lfs clean -- %f",
    "system\tfilter.sys.process sys-filter",
    "command\tfilter.cmd.clean x",
    "local\tfilter.evil.clean touch /tmp/pwned",
    "worktree\tfilter.w.process touch W",
    "local\tfilter.evil.clean again",
    "",
  ].join("\n");
  assert.deepEqual(repoFilterCommands(out), ["filter.evil.clean", "filter.w.process"]);
});

test("repoFilterCommands finds nothing in empty or global-only output", () => {
  assert.deepEqual(repoFilterCommands(""), []);
  assert.deepEqual(repoFilterCommands("global\tfilter.lfs.smudge git-lfs smudge -- %f\n"), []);
});

test("repoFilterCommands copes with a key that has no value", () => {
  assert.deepEqual(repoFilterCommands("local\tfilter.bare.clean\n"), ["filter.bare.clean"]);
});
