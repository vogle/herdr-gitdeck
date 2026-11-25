// The labels a commit row shows, as the Git panel draws them: a local branch
// carries its same-named remote branches ("main │ origin"), a remote branch or a
// tag alone gets its own label, and the checked-out branch comes first.

import type { Ref } from "../git/refs.ts";

export interface LabelPart {
  kind: "branch" | "remote" | "tag";
  /** The full ref name, for a tooltip or a search. */
  name: string;
  /** What the label shows: cut short with an ellipsis. */
  text: string;
}

export interface RefLabel {
  kind: "branch" | "remote" | "tag";
  /** The checked-out branch. */
  current: boolean;
  parts: readonly LabelPart[];
}

const MAX = 22;
const MAX_REMOTE = 12;
const fit = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function refLabels(refs: readonly Ref[]): RefLabel[] {
  const remotes = refs.filter((r) => r.kind === "remote");
  const branches = refs.filter((r) => r.kind === "branch");
  const paired = new Set<string>();
  const branchLabels = branches.map((b): RefLabel => {
    const riders = remotes.filter((r) => !paired.has(r.name) && r.name.slice(r.name.indexOf("/") + 1) === b.name);
    riders.forEach((r) => paired.add(r.name));
    const own: LabelPart = { kind: "branch", name: b.name, text: fit(b.name, MAX) };
    const rest = riders.map((r): LabelPart => ({ kind: "remote", name: r.name, text: fit(r.name.slice(0, r.name.indexOf("/")), MAX_REMOTE) }));
    return { kind: "branch", current: b.current, parts: [own, ...rest] };
  });
  const lone = remotes
    .filter((r) => !paired.has(r.name))
    .map((r): RefLabel => ({ kind: "remote", current: false, parts: [{ kind: "remote", name: r.name, text: fit(r.name, MAX) }] }));
  const tags = refs
    .filter((r) => r.kind === "tag")
    .map((r): RefLabel => ({ kind: "tag", current: false, parts: [{ kind: "tag", name: r.name, text: fit(r.name, MAX) }] }));
  const current = branchLabels.filter((l) => l.current);
  return [...current, ...branchLabels.filter((l) => !l.current), ...lone, ...tags];
}
