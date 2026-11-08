import { test } from "node:test";
import assert from "node:assert/strict";
import { imageExt, blobIdArgs, writeBlobArgs, loadImagePair, MAX_IMAGE } from "../src/core/imageDiff.ts";

const A = "a".repeat(40);
const P = "p".repeat(40).replace(/p/g, "b");
const OLD = "1".repeat(40);
const NEW = "2".repeat(40);
const cache = { abs: "/app/mods/githerd/.cache/img", rel: "mods/githerd/.cache/img" };
const local = { cwd: "/r", on: null };

test("imageExt knows the raster formats Herdr draws, and nothing else", () => {
  assert.equal(imageExt("a/b.PNG"), "png");
  assert.equal(imageExt("x.jpeg"), "jpeg");
  assert.equal(imageExt("x.svg"), null, "SVG is text: its diff stays a text diff");
  assert.equal(imageExt("png"), null);
  assert.equal(imageExt("x.txt"), null);
});

test("blob ids are read with rev-parse, and a blob is written raw with cat-file", () => {
  assert.deepEqual(blobIdArgs(A, "img/a.png"), ["rev-parse", "--verify", "--quiet", `${A}:img/a.png`]);
  const args = writeBlobArgs(OLD, "/app/x/1.png");
  assert.equal(args[0], "-c");
  assert.match(args[1] ?? "", /cat-file blob/);
  assert.ok(args.includes(OLD) && args.includes("/app/x/1.png"), "id and path go in as arguments, never into the script");
});

function fakeGit(map: Record<string, string>) {
  return async (_t: unknown, args: string[]) => {
    const key = args.join(" ");
    for (const [k, v] of Object.entries(map)) if (key.includes(k)) return v;
    throw new Error(`fatal: ${key}`);
  };
}

test("a changed image gives the before and after files, written once into the cache", async () => {
  const runs: string[][] = [];
  const exec = async (c: string, a: string[]) => {
    runs.push([c, ...a]);
    return { code: 0, stdout: "", stderr: "" };
  };
  const git = fakeGit({ [`${P}:old.png`]: `${OLD}\n`, [`${A}:new.png`]: `${NEW}\n`, "cat-file -s": "100\n" });
  const r = await loadImagePair(git, exec, local, { hash: A, parents: [P], path: "new.png", oldPath: "old.png" }, cache);
  assert.deepEqual(r, { old: `${cache.rel}/${OLD}.png`, new: `${cache.rel}/${NEW}.png`, note: null });
  assert.equal(runs[0]?.[0], "mkdir");
  assert.equal(runs.filter((x) => x[0] === "sh").length, 2);
});

test("an added image has no before; a root commit has no parent to read", async () => {
  const exec = async () => ({ code: 0, stdout: "", stderr: "" });
  const git = fakeGit({ [`${A}:a.png`]: `${NEW}\n`, "cat-file -s": "5\n" });
  const r = await loadImagePair(git, exec, local, { hash: A, parents: [], path: "a.png", oldPath: null }, cache);
  assert.deepEqual(r, { old: null, new: `${cache.rel}/${NEW}.png`, note: null });
});

test("not an image, another machine, too big, or a failed write: no pictures, a reason", async () => {
  const ok = async () => ({ code: 0, stdout: "", stderr: "" });
  const src = { hash: A, parents: [P], path: "a.png", oldPath: null };
  assert.equal(await loadImagePair(fakeGit({}), ok, local, { ...src, path: "a.txt" }, cache), null);
  assert.match((await loadImagePair(fakeGit({}), ok, { cwd: "/r", on: "box" }, src, cache))?.note ?? "", /this machine/);
  const big = fakeGit({ ":a.png": `${NEW}\n`, "cat-file -s": `${MAX_IMAGE + 1}\n` });
  assert.match((await loadImagePair(big, ok, local, src, cache))?.note ?? "", /Too big/);
  const fails = async () => ({ code: 1, stdout: "", stderr: "disk full\n" });
  assert.match((await loadImagePair(fakeGit({ ":a.png": `${NEW}\n`, "cat-file -s": "5\n" }), fails, local, src, cache))?.note ?? "", /disk full/);
  const bad = fakeGit({ ":a.png": "not-an-id\n", "cat-file -s": "5\n" });
  assert.deepEqual(await loadImagePair(bad, ok, local, src, cache), { old: null, new: null, note: null });
});
