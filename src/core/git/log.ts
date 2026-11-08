// The commit graph's rows: `git log` over every branch, remote branch and tag.

const FIELD = "\x1f";
const RECORD = "\x1e";

export interface Commit {
  hash: string;
  parents: readonly string[];
  author: string;
  email: string;
  /** Author time, Unix seconds. */
  time: number;
  subject: string;
}

/** Newest first, each child before its parents (what the lane layout needs). */
export function logArgs(limit: number): string[] {
  return [
    "log",
    // A repo's log.showSignature would have it run its own gpg.program.
    "--no-show-signature",
    "--date-order",
    `--format=%H${"%x1f"}%P${"%x1f"}%an${"%x1f"}%ae${"%x1f"}%at${"%x1f"}%s${"%x1e"}`,
    `--max-count=${limit}`,
    "--branches",
    "--remotes",
    "--tags",
    "HEAD",
    "--",
  ];
}

function commitOf(record: string): Commit | null {
  const [hash = "", parents = "", author = "", email = "", time = "", subject = ""] = record.split(FIELD);
  if (!/^[0-9a-f]{7,64}$/.test(hash)) return null;
  return {
    hash,
    parents: parents === "" ? [] : parents.split(" "),
    author,
    email,
    time: Number(time) || 0,
    subject,
  };
}

export function parseLog(output: string): Commit[] {
  return output
    .split(RECORD)
    .map((record) => commitOf(record.replace(/^\n/, "")))
    .filter((c): c is Commit => c !== null);
}

export const STASH_ARGS: readonly string[] = ["stash", "list", "--no-show-signature", `--format=%H${"%x1f"}%gd${"%x1f"}%s`];

export interface Stash {
  hash: string;
  /** stash@{0} */
  name: string;
  subject: string;
}

export function parseStashes(output: string): Stash[] {
  return output
    .split("\n")
    .map((line) => line.split(FIELD))
    .filter(([hash = "", name = ""]) => /^[0-9a-f]{7,64}$/.test(hash) && name !== "")
    .map(([hash = "", name = "", subject = ""]) => ({ hash, name, subject }));
}
