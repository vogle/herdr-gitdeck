// One commit's details: its header, whole message and the files it changed.

const FIELD = "\x1f";

/** Never run a program a repo's config names for diffs (diff.external, textconv). */
export const SAFE_DIFF: readonly string[] = ["--no-ext-diff", "--no-textconv", "--no-color"];

export interface CommitDetail {
  hash: string;
  parents: readonly string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  message: string;
}

export function detailArgs(hash: string): string[] {
  return ["show", "-s", "--no-show-signature", "--no-color", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B", hash, "--"];
}

export function parseDetail(output: string): CommitDetail | null {
  const fields = output.split(FIELD);
  const [hash = "", parents = "", author = "", email = "", time = "", committer = "", committerEmail = "", commitTime = ""] = fields;
  if (!/^[0-9a-f]{7,64}$/.test(hash)) return null;
  return {
    hash,
    parents: parents === "" ? [] : parents.split(" "),
    author,
    email,
    time: Number(time) || 0,
    committer,
    committerEmail,
    commitTime: Number(commitTime) || 0,
    // The message itself may hold the separator: everything after the eighth field.
    message: fields.slice(8).join(FIELD).replace(/\n+$/, ""),
  };
}

/** What a commit is compared with: its first parent, or nothing at the root. */
function base(hash: string, parents: readonly string[]): string[] {
  const [first] = parents;
  return first === undefined ? ["--root", hash] : [first, hash];
}

export function filesArgs(hash: string, parents: readonly string[], mode: "--name-status" | "--numstat" | "--raw"): string[] {
  // Raw output abbreviates blob ids unless told not to.
  const modes = mode === "--raw" ? ["--raw", "--no-abbrev"] : [mode];
  return ["diff-tree", "-r", "-z", "-M", "--no-commit-id", ...SAFE_DIFF, ...modes, ...base(hash, parents)];
}

export interface FileChange {
  /** A, M, D, R, C, T. */
  status: string;
  path: string;
  /** A rename's or copy's source. */
  oldPath: string | null;
}

export function parseNameStatus(output: string): FileChange[] {
  const tokens = output.split("\0");
  const changes: FileChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i] ?? "";
    if (!/^[A-Z]/.test(code)) continue;
    const status = code.charAt(0);
    if (status === "R" || status === "C") {
      changes.push({ status, oldPath: tokens[i + 1] ?? "", path: tokens[i + 2] ?? "" });
      i += 2;
    } else {
      changes.push({ status, path: tokens[i + 1] ?? "", oldPath: null });
      i += 1;
    }
  }
  return changes;
}

export interface LineCounts {
  added: number;
  deleted: number;
  binary: boolean;
}

export function parseNumstat(output: string): Readonly<Record<string, LineCounts>> {
  const tokens = output.split("\0");
  const counts = new Map<string, LineCounts>();
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i] ?? "");
    if (!m) continue;
    const binary = m[1] === "-";
    let path = m[3] ?? "";
    // A rename: an empty path, then the old and new names.
    if (path === "") {
      path = tokens[i + 2] ?? "";
      i += 2;
    }
    counts.set(path, { added: binary ? 0 : Number(m[1]), deleted: binary ? 0 : Number(m[2]), binary });
  }
  return Object.fromEntries(counts);
}

export type CommitFile = FileChange & LineCounts;

export function joinFiles(changes: readonly FileChange[], counts: Readonly<Record<string, LineCounts>>): CommitFile[] {
  return changes.map((c) => ({ ...c, ...(counts[c.path] ?? { added: 0, deleted: 0, binary: false }) }));
}

export function commitDiffArgs(hash: string, parents: readonly string[], file: { path: string; oldPath: string | null }): string[] {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
  return ["diff-tree", "-p", "-M", ...SAFE_DIFF, ...base(hash, parents), "--", ...paths];
}

/** A changed file in the work tree against HEAD (or the index before the first commit). */
export function worktreeDiffArgs(path: string, hasHead: boolean): string[] {
  return ["diff", ...SAFE_DIFF, hasHead ? "HEAD" : "--cached", "--", path];
}

/** An untracked file shown as all added. Exits 1 when there is a difference. */
export function untrackedDiffArgs(path: string): string[] {
  return ["diff", ...SAFE_DIFF, "--no-index", "--", "/dev/null", path];
}
