// POSIX path helpers. The Herdr runtime has no Node `path`, and git paths are POSIX.

export function trimSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function dirname(path: string): string {
  const p = trimSlash(path);
  const cut = p.lastIndexOf("/");
  return cut <= 0 ? "/" : p.slice(0, cut);
}

export function basename(path: string): string {
  const p = trimSlash(path);
  return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1);
}

/** `path` is `folder` itself or somewhere below it. */
export function isInside(path: string, folder: string): boolean {
  const p = trimSlash(path);
  const f = trimSlash(folder);
  if (f === "/") return p.startsWith("/");
  return p === f || p.startsWith(`${f}/`);
}

/** The part of `path` below `folder` ("" for the folder itself). Assumes isInside. */
export function relative(folder: string, path: string): string {
  const f = trimSlash(folder);
  const p = trimSlash(path);
  if (p === f) return "";
  return f === "/" ? p.slice(1) : p.slice(f.length + 1);
}
