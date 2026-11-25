// Image diff (M4): a changed image's before and after, drawn side by side.
// Each version is written from git's objects (cat-file: no filters, no
// textconv) into a cache folder the mod can draw from, named by its object id.

import { GIT_FLAGS, type Exec, type Git, type Target } from "./git/runner.ts";

export const MAX_IMAGE = 20_000_000;

const RASTER = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);

/** The extension of an image Herdr can draw, else null (SVG is text: it keeps a text diff). */
export function imageExt(path: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  const ext = m?.[1]?.toLowerCase() ?? "";
  return RASTER.has(ext) ? ext : null;
}

export const blobIdArgs = (rev: string, path: string): string[] => ["rev-parse", "--verify", "--quiet", `${rev}:${path}`];

// The id and the path are arguments to the script, never part of it.
const WRITE = 'oid=$1; out=$2; shift 2; [ -s "$out" ] && exit 0; git "$@" cat-file blob "$oid" > "$out.part" && mv -f "$out.part" "$out"';

/** `sh` arguments that write blob `oid` to `out` once. */
export const writeBlobArgs = (oid: string, out: string): string[] => ["-c", WRITE, "sh", oid, out, ...GIT_FLAGS];

export interface ImagePair {
  /** Paths for `image()`, relative to Herdr's app folder; null where that side has no file. */
  old: string | null;
  new: string | null;
  /** Why there are no pictures. */
  note: string | null;
}

export interface ImageSource {
  hash: string;
  parents: readonly string[];
  path: string;
  oldPath: string | null;
}

const OID = /^[0-9a-f]{40,64}$/;

async function blobId(git: Git, target: Target, rev: string | undefined, path: string): Promise<string | null> {
  if (rev === undefined) return null;
  const id = await git(target, blobIdArgs(rev, path)).then((s) => s.trim(), () => "");
  return OID.test(id) ? id : null;
}

/** The extension of a file the viewer tab draws as a picture: the raster formats, and SVG. */
export function pictureExt(path: string): string | null {
  return imageExt(path) ?? (/\.svg$/i.test(path) ? "svg" : null);
}

/** null when the file isn't an image. `cache.abs` is where to write, `cache.rel` the same folder for `image()`. */
export async function loadImagePair(git: Git, exec: Exec, target: Target, src: ImageSource, cache: { abs: string; rel: string }): Promise<ImagePair | null> {
  const ext = imageExt(src.path);
  return ext === null ? null : writePair(git, exec, target, src, ext, cache);
}

/** Writes the before and after of `src` into the cache, as `ext` files. */
async function writePair(git: Git, exec: Exec, target: Target, src: ImageSource, ext: string, cache: { abs: string; rel: string }): Promise<ImagePair> {
  if (target.on !== null) return { old: null, new: null, note: "Images are drawn for repos on this machine only" };
  const ids = await Promise.all([blobId(git, target, src.parents[0], src.oldPath ?? src.path), blobId(git, target, src.hash, src.path)]);
  try {
    for (const id of ids) {
      if (id === null) continue;
      const size = Number((await git(target, ["cat-file", "-s", id])).trim());
      if (!(size <= MAX_IMAGE)) return { old: null, new: null, note: `Too big to draw (${size} bytes)` };
    }
    await exec("mkdir", ["-p", cache.abs], {});
    const out: (string | null)[] = [];
    for (const id of ids) {
      if (id === null) {
        out.push(null);
        continue;
      }
      const r = await exec("sh", writeBlobArgs(id, `${cache.abs}/${id}.${ext}`), { cwd: target.cwd });
      if (r.code !== 0) return { old: null, new: null, note: r.stderr.split("\n")[0] || `Couldn't write the image (${r.code})` };
      out.push(`${cache.rel}/${id}.${ext}`);
    }
    return { old: out[0] ?? null, new: out[1] ?? null, note: null };
  } catch (error) {
    return { old: null, new: null, note: error instanceof Error ? error.message : String(error) };
  }
}

/** How large an SVG is drawn before it is fitted to the tab: a vector drawn small and stretched blurs. */
export const SVG_PX = 1024;
/** Above this, an SVG is written as it is (its text goes to the shell as one argument). */
const MAX_SIZED_SVG = 200_000;

/** `text` with its root `<svg>` sized `px` on its longer side (the viewBox's shape kept), dropping any size it had. */
export function sizedSvg(text: string, px: number): string {
  const root = /<svg\b[^>]*>/.exec(text);
  if (!root) return text;
  const tag = root[0];
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(tag);
  const [w, h] = box ? [Number(box[1]), Number(box[2])] : [1, 1];
  const long = Math.max(w, h) || 1;
  const size = `width="${Math.round((px * w) / long)}" height="${Math.round((px * h) / long)}"`;
  const bare = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/g, "");
  return text.slice(0, root.index) + bare.replace(/^<svg/, `<svg ${size}`) + text.slice(root.index + tag.length);
}

const WRITE_TEXT = 'out=$1; [ -s "$out" ] && exit 0; printf %s "$2" > "$out.part" && mv -f "$out.part" "$out"';

/** An SVG at `rev`, written resized so it is drawn sharp; null to fall back to the file as it is. */
async function writeSvg(git: Git, exec: Exec, target: Target, rev: string, path: string, cache: { abs: string; rel: string }): Promise<{ path: string | null; note: string | null } | null> {
  const id = await blobId(git, target, rev, path);
  if (id === null || target.on !== null) return null;
  try {
    const size = Number((await git(target, ["cat-file", "-s", id])).trim());
    if (!(size <= MAX_SIZED_SVG)) return null;
    const text = sizedSvg(await git(target, ["cat-file", "blob", id]), SVG_PX);
    await exec("mkdir", ["-p", cache.abs], {});
    const r = await exec("sh", ["-c", WRITE_TEXT, "sh", `${cache.abs}/${id}.big.svg`, text], { cwd: target.cwd });
    if (r.code !== 0) return { path: null, note: r.stderr.split("\n")[0] || `Couldn't write the image (${r.code})` };
    return { path: `${cache.rel}/${id}.big.svg`, note: null };
  } catch {
    return null;
  }
}

/** One commit's image, for the viewer tab: `path` for `image()`, or a note on why it can't be drawn. null when the file isn't an image. */
export async function loadImageAt(git: Git, exec: Exec, target: Target, rev: string, path: string, cache: { abs: string; rel: string }): Promise<{ path: string | null; note: string | null } | null> {
  const ext = pictureExt(path);
  if (ext === null) return null;
  if (ext === "svg") {
    const sized = await writeSvg(git, exec, target, rev, path, cache);
    if (sized) return sized;
  }
  const pair = await writePair(git, exec, target, { hash: rev, parents: [], path, oldPath: null }, ext, cache);
  if (pair.note !== null || pair.new !== null) return { path: pair.new, note: pair.note };
  return { path: null, note: `${path} is not in ${rev.slice(0, 10)}` };
}
