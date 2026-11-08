// Repository statistics (M5): commits, who made them, and when.

import type { Git, Target } from "./git/runner.ts";

export const MAX_STATS = 50_000;

export const statsArgs = (): string[] =>
  ["log", "--no-show-signature", "--no-merges", "--format=%an%x1f%ae%x1f%at", `--max-count=${MAX_STATS}`, "HEAD", "--"];

export interface Author {
  name: string;
  email: string;
  count: number;
}

export interface Stats {
  commits: number;
  files: number;
  /** Most commits first. */
  authors: readonly Author[];
  /** Every month from the first commit to the last, oldest first. */
  months: readonly { month: string; count: number }[];
  first: number | null;
  last: number | null;
  error: string | null;
}

const monthOf = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 7);

function monthsBetween(first: number, last: number, counts: ReadonlyMap<string, number>): { month: string; count: number }[] {
  const out: { month: string; count: number }[] = [];
  const d = new Date(first * 1000);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  const end = monthOf(last);
  for (;;) {
    const month = `${y}-${String(m + 1).padStart(2, "0")}`;
    out.push({ month, count: counts.get(month) ?? 0 });
    if (month >= end) return out;
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
}

export function parseStats(output: string, files: number): Stats {
  const authors = new Map<string, Author>();
  const counts = new Map<string, number>();
  let commits = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const line of output.split("\n")) {
    const [name = "", email = "", time = ""] = line.split("\x1f");
    const t = Number(time);
    if (time === "" || !Number.isFinite(t)) continue;
    commits += 1;
    const key = `${name}\x1f${email}`;
    const a = authors.get(key);
    authors.set(key, { name, email, count: (a?.count ?? 0) + 1 });
    counts.set(monthOf(t), (counts.get(monthOf(t)) ?? 0) + 1);
    first = first === null ? t : Math.min(first, t);
    last = last === null ? t : Math.max(last, t);
  }
  return {
    commits,
    files,
    authors: [...authors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    months: first === null || last === null ? [] : monthsBetween(first, last, counts),
    first,
    last,
    error: null,
  };
}

export async function loadStats(git: Git, target: Target): Promise<Stats> {
  try {
    const [log, list] = await Promise.all([git(target, statsArgs()), git(target, ["ls-files", "-z"])]);
    return parseStats(log, list.split("\0").filter((f) => f !== "").length);
  } catch (error) {
    return { ...parseStats("", 0), error: error instanceof Error ? error.message : String(error) };
  }
}
