// git-flow (M5) without the git-flow tool: a feature or release branch starts
// from develop, a hotfix from main (or master).

export const FLOW_KINDS = ["feature", "release", "hotfix"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

/** The branch a new one starts from, or null when the repo has none to use. */
export function flowBase(kind: FlowKind, branches: readonly string[]): string | null {
  if (kind !== "hotfix") return branches.includes("develop") ? "develop" : null;
  return ["main", "master"].find((b) => branches.includes(b)) ?? null;
}

/** The git-flow branches to offer: none unless the repo uses git-flow (it has develop). */
export function flowKinds(branches: readonly string[]): FlowKind[] {
  if (!branches.includes("develop")) return [];
  return FLOW_KINDS.filter((k) => flowBase(k, branches) !== null);
}

export const flowBranch = (kind: FlowKind, name: string): string => `${kind}/${name}`;
