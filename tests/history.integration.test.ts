// Real git on a repo whose own config names programs for signatures and diffs:
// the history view's commands must read it without running any of them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath, access, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { loadHistory, loadCommit, loadDiff } from "../src/core/history.ts";

const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
const exists = (p: string) => access(p).then(() => true, () => false);

let dir = "";
let marker = "";
let at = { cwd: "", on: null as string | null };

before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "githerd-hist-")));
  marker = join(dir, "..", `${dir.split("/").pop()}-ran`);
  at = { cwd: dir, on: null };
  const trap = join(dir, ".trap.sh");
  await writeFile(trap, `#!/bin/sh\ntouch '${marker}'\n`);
  await chmod(trap, 0o755);
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "t"], ["config", "commit.gpgsign", "false"]]) {
    await git(at, args);
  }
  await writeFile(join(dir, ".gitattributes"), "*.txt diff=evil\n");
  await writeFile(join(dir, "a.txt"), "one\n");
  await git(at, ["add", ".gitattributes", "a.txt"]);
  await git(at, ["commit", "-q", "-m", "first"]);
  await writeFile(join(dir, "a.txt"), "two\n");
  await git(at, ["commit", "-q", "-am", "second"]);
  // Re-write HEAD as a "signed" commit, so a signature check would call gpg.program.
  const raw = await git(at, ["cat-file", "commit", "HEAD"]);
  const signed = raw.replace(/\n\n/, "\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n x\n -----END PGP SIGNATURE-----\n\n");
  await writeFile(join(dir, ".signed"), signed);
  const oid = (await git(at, ["hash-object", "-t", "commit", "-w", ".signed"])).trim();
  await git(at, ["update-ref", "refs/heads/main", oid]);
  // The traps, in the repo's own config.
  for (const [k, v] of [["log.showSignature", "true"], ["gpg.program", trap], ["diff.external", trap], ["diff.evil.textconv", trap]]) {
    await git(at, ["config", k ?? "", v ?? ""]);
  }
  await writeFile(join(dir, "a.txt"), "three\n");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(marker, { force: true });
});

test("the history, a commit, its diff and a work-tree diff run none of the repo's programs", async () => {
  const h = await loadHistory(git, at, 100);
  assert.equal(h.error, null);
  assert.deepEqual(h.commits.map((c) => c.subject), ["second", "first"]);
  const head = h.commits[0];
  assert.ok(head);
  const c = await loadCommit(git, at, head.hash, head.parents);
  assert.equal(c.error, null);
  assert.deepEqual(c.files.map((f) => [f.status, f.path, f.added, f.deleted]), [["M", "a.txt", 1, 1]]);
  const d = await loadDiff(git, at, { kind: "commit", hash: head.hash, parents: head.parents, path: "a.txt", oldPath: null });
  assert.deepEqual(d.rows.filter((r) => r.kind !== "hunk").map((r) => `${r.kind}:${r.text}`), ["del:one", "add:two"]);
  const w = await loadDiff(git, at, { kind: "worktree", path: "a.txt", hasHead: true });
  assert.deepEqual(w.rows.filter((r) => r.kind === "add").map((r) => r.text), ["three"]);
  const u = await loadDiff(git, at, { kind: "untracked", path: ".trap.sh" });
  assert.ok(u.rows.some((r) => r.kind === "add"));
  assert.equal(await exists(marker), false, "a repo-configured program ran");
});

test("the trap is real: plain git log runs gpg.program", async () => {
  await git(at, ["log", "-1"]);
  assert.equal(await exists(marker), true);
});
