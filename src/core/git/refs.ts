// Branches, remote branches and tags, and which commit each points at.

const FIELD = "\x1f";

export const REFS_ARGS: readonly string[] = [
  "for-each-ref",
  "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)",
  "refs/heads",
  "refs/remotes",
  "refs/tags",
];

export type RefKind = "branch" | "remote" | "tag";

export interface Ref {
  kind: RefKind;
  /** The full name: refs/heads/main. */
  full: string;
  /** What people call it: main, origin/main, v1.0. */
  name: string;
  /** The commit (an annotated tag's target, not the tag object). */
  hash: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The branch HEAD is on. */
  current: boolean;
}

const PREFIXES: ReadonlyArray<readonly [string, RefKind]> = [
  ["refs/heads/", "branch"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
];

/** "ahead 2, behind 1", "ahead 3", "gone", "". */
function track(text: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(text);
  const behind = /behind (\d+)/.exec(text);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}

function refOf(line: string): Ref | null {
  const [full = "", object = "", peeled = "", upstream = "", tracking = "", head = ""] = line.split(FIELD);
  const prefix = PREFIXES.find(([p]) => full.startsWith(p));
  if (!prefix) return null;
  const name = full.slice(prefix[0].length);
  // origin/HEAD only repeats where origin's default branch is.
  if (prefix[1] === "remote" && name.endsWith("/HEAD")) return null;
  const hash = peeled !== "" ? peeled : object;
  if (hash === "") return null;
  return { kind: prefix[1], full, name, hash, upstream: upstream === "" ? null : upstream, ...track(tracking), current: head === "*" };
}

export function parseRefs(output: string): Ref[] {
  return output
    .split("\n")
    .map(refOf)
    .filter((r): r is Ref => r !== null);
}

/** The refs on each commit: the current branch first, then branches, tags, remotes. */
export function refsByCommit(refs: readonly Ref[]): Readonly<Record<string, readonly Ref[]>> {
  const order = (r: Ref) => (r.current ? 0 : r.kind === "branch" ? 1 : r.kind === "tag" ? 2 : 3);
  const sorted = [...refs].sort((a, b) => order(a) - order(b));
  // A local accumulator: thousands of tags would make copying per ref quadratic.
  const byHash = new Map<string, Ref[]>();
  for (const ref of sorted) byHash.set(ref.hash, [...(byHash.get(ref.hash) ?? []), ref]);
  return Object.fromEntries(byHash);
}
