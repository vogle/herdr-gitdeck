// Which Review-tab files the person has viewed, and the queue the viewer steps
// through. A file is marked with the blob it had when viewed: once the agent
// changes it again, the blob moves on and the mark reads "changed since viewed".
// Both live in shared values, so the panel and the viewer tab see the same thing.

/** Shared value: repo path → (file path → blob seen). */
export const REVIEWED_KEY = "gitdeck.reviewed";
/** Shared value: the Review tab's files in order, for the viewer's previous / next. */
export const REVIEW_QUEUE_KEY = "gitdeck.review.queue";

export type Seen = Readonly<Record<string, string>>;
export type ViewState = "unseen" | "viewed" | "changed";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const NO_BLOB = /^0+$/;

/**
 * Each file's blob after the change, from `diff-tree -r -z --raw --no-abbrev`:
 * a deleted file has none, so it is keyed by the blob it had.
 */
export function parseBlobs(raw: string): Map<string, string> {
  const parts = raw.split("\0");
  const blobs = new Map<string, string>();
  for (let i = 0; i < parts.length; i++) {
    const meta = parts[i] ?? "";
    if (!meta.startsWith(":")) continue;
    const [, , oldBlob = "", newBlob = "", status = ""] = meta.split(" ");
    const twoPaths = status.startsWith("R") || status.startsWith("C");
    const path = parts[twoPaths ? i + 2 : i + 1];
    i += twoPaths ? 2 : 1;
    if (path) blobs.set(path, NO_BLOB.test(newBlob) ? `deleted:${oldBlob}` : newBlob);
  }
  return blobs;
}

/** One repo's marks from the shared value, anything malformed dropped. */
export function seenFor(all: unknown, repo: string): Seen {
  const mine = isObj(all) ? all[repo] : null;
  if (!isObj(mine)) return {};
  return Object.fromEntries(Object.entries(mine).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function viewState(seen: Seen, path: string, blob: string | undefined): ViewState {
  const mark = seen[path];
  if (mark === undefined) return "unseen";
  return blob === undefined || mark === blob ? "viewed" : "changed";
}

/**
 * The shared value with one file marked (or unmarked). Marks of files no longer
 * in the review (`current`) are dropped, so the value stays small.
 */
export function withViewed(all: unknown, repo: string, path: string, blob: string, viewed: boolean, current: readonly string[]): Record<string, Seen> {
  const kept = new Set(current);
  const seen = Object.fromEntries(Object.entries(seenFor(all, repo)).filter(([p]) => kept.has(p) && p !== path));
  const others = isObj(all) ? Object.fromEntries(Object.entries(all).filter(([r, v]) => r !== repo && isObj(v)).map(([r]) => [r, seenFor(all, r)])) : {};
  return { ...others, [repo]: viewed ? { ...seen, [path]: blob } : seen };
}

export function viewedCount(paths: readonly string[], seen: Seen, blobs: ReadonlyMap<string, string>): number {
  return paths.filter((p) => viewState(seen, p, blobs.get(p)) === "viewed").length;
}

export interface QueueFile {
  path: string;
  oldPath: string | null;
  blob: string;
}

/** The files of one review, in reading order, and what their diffs compare. */
export interface ReviewQueue {
  repo: string;
  on: string | null;
  head: string;
  mergeBase: string;
  files: readonly QueueFile[];
}

function parseFile(v: unknown): QueueFile | null {
  if (!isObj(v) || !isText(v.path) || typeof v.blob !== "string") return null;
  if (v.oldPath !== null && !isText(v.oldPath)) return null;
  return { path: v.path, oldPath: v.oldPath, blob: v.blob };
}

export function parseQueue(v: unknown): ReviewQueue | null {
  if (!isObj(v) || !isText(v.repo) || !v.repo.startsWith("/") || !isText(v.head) || !isText(v.mergeBase)) return null;
  if (v.on !== null && !isText(v.on)) return null;
  if (!Array.isArray(v.files)) return null;
  const files = v.files.map(parseFile);
  if (files.some((f) => f === null)) return null;
  return { repo: v.repo, on: v.on, head: v.head, mergeBase: v.mergeBase, files: files as QueueFile[] };
}

/** The file before (-1) or after (1) `path` in the queue; null at the ends. */
export function neighbor(queue: ReviewQueue, path: string, step: -1 | 1): QueueFile | null {
  const at = queue.files.findIndex((f) => f.path === path);
  return at < 0 ? null : (queue.files[at + step] ?? null);
}
