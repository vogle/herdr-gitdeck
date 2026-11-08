// Places commits on lanes (columns) for the graph. Input is newest first with
// every child before its parents (`git log --date-order`). A lane waits for one
// commit and keeps its column until that commit's row, so lines only bend where
// histories fork or join.

export interface LaneCommit {
  hash: string;
  parents: readonly string[];
  /** Uncommitted changes: the line to its parent is drawn dashed. */
  dashed?: boolean;
}

/**
 * A line inside one row, in lanes and row heights: y 0 is the row's top,
 * 0.5 the commit's dot, 1 the bottom.
 */
export interface Segment {
  from: number;
  fromY: number;
  to: number;
  toY: number;
  dashed: boolean;
}

export interface LaneRow {
  lane: number;
  segments: readonly Segment[];
}

export interface Lanes {
  rows: readonly LaneRow[];
  /** The most lanes any row uses. */
  width: number;
}

/** The lanes still waiting for a commit, as the layout walks down. Local to one call. */
class Waiting {
  readonly hashes: (string | null)[] = [];
  readonly dashed: boolean[] = [];

  free(skip = -1): number {
    const at = this.hashes.findIndex((h, i) => h === null && i !== skip);
    return at >= 0 ? at : Math.max(this.hashes.length, skip + 1);
  }

  set(lane: number, hash: string | null, dashed: boolean): void {
    this.hashes[lane] = hash;
    this.dashed[lane] = dashed;
  }

  trim(): void {
    while (this.hashes.length > 0 && this.hashes[this.hashes.length - 1] === null) {
      this.hashes.pop();
      this.dashed.pop();
    }
  }
}

function rowFor(commit: LaneCommit, waiting: Waiting): LaneRow {
  const before = [...waiting.hashes];
  const beforeDashed = [...waiting.dashed];
  const found = before.indexOf(commit.hash);
  const lane = found >= 0 ? found : waiting.free();
  const segments: Segment[] = [];

  // Lines coming down from above: into this dot, or straight past it.
  before.forEach((hash, i) => {
    if (hash === null || hash === undefined) return;
    const dashed = Boolean(beforeDashed[i]);
    if (hash === commit.hash) {
      segments.push({ from: i, fromY: 0, to: lane, toY: 0.5, dashed });
      if (i !== lane) waiting.set(i, null, false);
    } else segments.push({ from: i, fromY: 0, to: i, toY: 1, dashed });
  });

  // Lines going down from this dot to its parents.
  const dashed = Boolean(commit.dashed);
  const [first, ...rest] = commit.parents;
  waiting.set(lane, null, false);
  // The first parent keeps this lane even when another lane waits for it too:
  // the two join at the parent's dot, so the line runs straight until then.
  if (first !== undefined) {
    waiting.set(lane, first, dashed);
    segments.push({ from: lane, fromY: 0.5, to: lane, toY: 1, dashed });
  }
  for (const parent of rest) {
    const known = waiting.hashes.indexOf(parent);
    const to = known >= 0 ? known : waiting.free(lane);
    if (known < 0) waiting.set(to, parent, dashed);
    segments.push({ from: lane, fromY: 0.5, to, toY: 1, dashed });
  }
  return { lane, segments };
}

export function layoutLanes(commits: readonly LaneCommit[]): Lanes {
  const waiting = new Waiting();
  let width = 0;
  const rows = commits.map((commit) => {
    const widthBefore = waiting.hashes.length;
    const row = rowFor(commit, waiting);
    width = Math.max(width, widthBefore, waiting.hashes.length, row.lane + 1);
    waiting.trim();
    return row;
  });
  return { rows, width };
}
