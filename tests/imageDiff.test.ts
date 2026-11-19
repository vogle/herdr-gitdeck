import { test } from "node:test";
import assert from "node:assert/strict";
import { imageExt, pictureExt, sizedSvg, blobIdArgs, writeBlobArgs, loadImagePair, loadImageAt, MAX_IMAGE } from "../src/core/imageDiff.ts";

const A = "a".repeat(40);
const P = "p".repeat(40).replace(/p/g, "b");
const OLD = "1".repeat(40);
const NEW = "2".repeat(40);
const cache = { abs: "/app/mods/gitdeck/.cache/img", rel: "mods/gitdeck/.cache/img" };
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

test("loadImageAt writes one commit's image for the viewer tab, or says why not", async () => {
  const exec = async () => ({ code: 0, stdout: "", stderr: "" });
  const git = fakeGit({ [`${A}:img/a.png`]: `${NEW}\n`, "cat-file -s": "5\n" });
  assert.deepEqual(await loadImageAt(git, exec, local, A, "img/a.png", cache), { path: `${cache.rel}/${NEW}.png`, note: null });
  assert.equal(await loadImageAt(git, exec, local, A, "a.txt", cache), null, "not an image");
  assert.match((await loadImageAt(git, exec, { cwd: "/r", on: "box" }, A, "a.png", cache))?.note ?? "", /this machine/);
  assert.match((await loadImageAt(fakeGit({}), exec, local, A, "gone.png", cache))?.note ?? "", /not in/);
});

test("pictureExt adds SVG for the viewer tab; a diff keeps SVG as text", () => {
  assert.equal(pictureExt("logo.SVG"), "svg");
  assert.equal(pictureExt("a.png"), "png");
  assert.equal(pictureExt("a.txt"), null);
  assert.equal(imageExt("logo.svg"), null);
});

test("sizedSvg sets a large drawing size on the root tag only, replacing any it had", () => {
  assert.equal(sizedSvg('<svg viewBox="0 0 16 16"><g/></svg>', 512), '<svg width="512" height="512" viewBox="0 0 16 16"><g/></svg>');
  assert.equal(sizedSvg('<?xml?>\n<svg width="16" height=\'8\' x="1"><svg width="2"/></svg>', 64), '<?xml?>\n<svg width="64" height="64" x="1"><svg width="2"/></svg>');
  assert.equal(sizedSvg("not svg", 64), "not svg");
});

test("loadImageAt writes an SVG resized, so it is drawn sharp", async () => {
  const runs: string[][] = [];
  const exec = async (c: string, a: string[]) => {
    runs.push([c, ...a]);
    return { code: 0, stdout: "", stderr: "" };
  };
  const git = fakeGit({ [`${A}:icons/x.svg`]: `${NEW}\n`, "cat-file -s": "40\n", [`cat-file blob ${NEW}`]: '<svg viewBox="0 0 16 16"/>' });
  assert.deepEqual(await loadImageAt(git, exec, local, A, "icons/x.svg", cache), { path: `${cache.rel}/${NEW}.big.svg`, note: null });
  const write = runs.find((r) => r[0] === "sh");
  assert.ok(write?.some((a) => a.includes('width="1024"')), "the resized text goes in as an argument");
});
