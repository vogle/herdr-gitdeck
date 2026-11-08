// Real git: blame, a renamed file's history, the reflog and taking a side.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit, type Exec } from "../src/core/git/runner.ts";
import { loadBlame, loadFileLog, loadReflog, takeSideArgs } from "../src/core/inspect.ts";

// A git hook running these tests sets GIT_AUTHOR_NAME and the like: drop them.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const exec: Exec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
const git = createGit(exec);
let at = { cwd: "", on: null as string | null };
const commit = async (msg: string) => git(at, ["commit", "-q", "-m", msg]);
const head = async () => (await git(at, ["rev-parse", "HEAD"])).trim();

before(async () => {
  at = { cwd: await realpath(await mkdtemp(join(tmpdir(), "githerd-inspect-"))), on: null };
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "Tess"], ["config", "commit.gpgsign", "false"]]) await git(at, a);
  await writeFile(join(at.cwd, "a.txt"), "one\ntwo\n");
  await git(at, ["add", "a.txt"]);
  await commit("first");
  await writeFile(join(at.cwd, "a.txt"), "one\nTWO\n");
  await git(at, ["commit", "-q", "-am", "second"]);
  await git(at, ["mv", "a.txt", "b.txt"]);
  await commit("rename");
});

after(() => rm(at.cwd, { recursive: true, force: true }));

test("blame names the commit of each line", async () => {
  const b = await loadBlame(git, at, await head(), "b.txt");
  assert.equal(b.error, null);
  assert.deepEqual(b.items.map((l) => [l.text, l.summary, l.author]), [["one", "first", "Tess"], ["TWO", "second", "Tess"]]);
});

test("a file's history follows its rename", async () => {
  const log = await loadFileLog(git, at, await head(), "b.txt");
  assert.deepEqual(log.items.map((c) => c.subject), ["rename", "second", "first"]);
  assert.match((await loadBlame(git, at, await head(), "missing.txt")).error ?? "", /./);
});

test("the reflog lists HEAD's moves, newest first", async () => {
  const r = await loadReflog(git, at);
  assert.deepEqual(r.items.map((e) => e.action), ["commit: rename", "commit: second", "commit (initial): first"]);
});

test("a conflict resolved by taking theirs", async () => {
  await git(at, ["switch", "-q", "-c", "side"]);
  await writeFile(join(at.cwd, "b.txt"), "side\n");
  await git(at, ["commit", "-q", "-am", "side"]);
  await git(at, ["switch", "-q", "main"]);
  await writeFile(join(at.cwd, "b.txt"), "main\n");
  await git(at, ["commit", "-q", "-am", "main"]);
  await assert.rejects(git(at, ["merge", "--no-edit", "side"]));
  await git(at, takeSideArgs("theirs", ["b.txt"]));
  assert.equal(await readFile(join(at.cwd, "b.txt"), "utf8"), "side\n");
  await git(at, ["merge", "--abort"]);
});

test("the tree at a commit lists its files and reads one as stored", async () => {
  const { loadTree, loadBlob } = await import("../src/core/tree.ts");
  const rev = await head();
  const tree = await loadTree(git, at, rev);
  assert.deepEqual(tree.files.map((f) => f.path), ["b.txt"]);
  const file = tree.files[0];
  assert.ok(file);
  assert.deepEqual(await loadBlob(git, at, rev, file), { lines: ["main"], note: null });
});

test("a conflict resolved block by block is written and staged", async () => {
  const { parseConflicts, choose, resolveFile } = await import("../src/core/conflict.ts");
  const files = {
    read: (p: string) => readFile(p, "utf8"),
    write: async (p: string, text: string) => writeFile(p, text),
    remove: async () => null,
  };
  await assert.rejects(git(at, ["merge", "--no-edit", "side"]));
  const original = await readFile(join(at.cwd, "b.txt"), "utf8");
  const segs = choose(parseConflicts(original), 0, "both");
  assert.equal(await resolveFile(git, files, at, "b.txt", original, segs), null);
  assert.equal(await readFile(join(at.cwd, "b.txt"), "utf8"), "main\nside\n");
  assert.equal((await git(at, ["diff", "--name-only", "--diff-filter=U"])).trim(), "", "no file left unmerged");
  await git(at, ["merge", "--abort"]);
});

test("stats count the commits, the author and the files", async () => {
  const { loadStats } = await import("../src/core/stats.ts");
  const s = await loadStats(git, at);
  assert.equal(s.error, null);
  // first, second, rename, main: "side" is on another branch, not in HEAD.
  assert.equal(s.commits, 4);
  assert.deepEqual(s.authors.map((a) => [a.name, a.count]), [["Tess", 4]]);
  assert.equal(s.files, 1);
  assert.equal(s.months.reduce((n, m) => n + m.count, 0), 4);
});

test("an LFS pointer and a submodule at a commit are described, never fetched or entered", async () => {
  const { loadTree, loadBlob } = await import("../src/core/tree.ts");
  const t = { cwd: await realpath(await mkdtemp(join(tmpdir(), "githerd-lfs-"))), on: null as string | null };
  try {
    for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@x.io"], ["config", "user.name", "Tess"], ["config", "commit.gpgsign", "false"]]) await git(t, a);
    await writeFile(join(t.cwd, "big.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${"d".repeat(64)}\nsize 999\n`);
    await writeFile(join(t.cwd, ".gitmodules"), '[submodule "lib"]\n\tpath = lib\n\turl = https://example.com/lib.git\n');
    await git(t, ["add", "big.bin", ".gitmodules"]);
    await git(t, ["update-index", "--add", "--cacheinfo", `160000,${"e".repeat(40)},lib`]);
    await git(t, ["commit", "-q", "-m", "lfs and submodule"]);
    const files = (await loadTree(git, t, "HEAD")).files;
    const big = files.find((f) => f.path === "big.bin");
    const lib = files.find((f) => f.path === "lib");
    assert.ok(big && lib);
    assert.equal(lib.kind, "submodule");
    assert.match((await loadBlob(git, t, "HEAD", big)).note ?? "", /Git LFS file: 999 bytes/);
    assert.match((await loadBlob(git, t, "HEAD", lib)).note ?? "", /eeeeeeeeee, from https:\/\/example\.com\/lib\.git/);
  } finally {
    await rm(t.cwd, { recursive: true, force: true });
  }
});
