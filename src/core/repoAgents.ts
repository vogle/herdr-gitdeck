// Which coding agents are working in the shown repo, and what to tell the person
// before they commit: an agent still working may leave half-made changes behind.

export type AgentStatus = "working" | "blocked" | "done" | "idle";

export interface RepoAgent {
  name: string;
  /** Herdr's program key, e.g. "claude" or "codex". */
  key: string;
  status: AgentStatus;
}

export interface AgentNote {
  kind: "working" | "blocked" | "done";
  text: string;
}

interface AgentLike {
  pane: string;
  status: AgentStatus;
  program: { name: string; key: string };
}

interface PaneLike {
  pane: string;
  cwd: string | null;
}

// A mod pane (the viewer tab) can come back with no cwd at all, despite the type.
const inside = (repo: string, cwd: string | null): boolean => typeof cwd === "string" && (cwd === repo || cwd.startsWith(`${repo}/`));

/** The agents whose terminal is in the repo or a folder below it. */
export function repoAgents(repo: string | null, agents: readonly AgentLike[], panes: readonly PaneLike[]): RepoAgent[] {
  if (repo === null) return [];
  const here = new Set(panes.filter((p) => inside(repo, p.cwd)).map((p) => p.pane));
  return agents.filter((a) => here.has(a.pane)).map((a) => ({ name: a.program.name, key: a.program.key, status: a.status }));
}

type Named = Pick<RepoAgent, "name" | "status">;

function say(kind: AgentNote["kind"], who: readonly Named[]): AgentNote {
  const one = who.length === 1;
  const name = one ? (who[0]?.name ?? "An agent") : `${who.length} agents`;
  if (kind === "working") {
    return { kind, text: `${name} ${one ? "is" : "are"} working here: ${one ? "its" : "their"} changes may not be finished` };
  }
  if (kind === "blocked") return { kind, text: `${name} ${one ? "is" : "are"} waiting for you` };
  return { kind, text: `${name} finished: review ${one ? "its" : "their"} changes before committing` };
}

/**
 * Why an action that rewrites the work tree (switch, reset, merge, stash...)
 * should wait: an agent is still writing there. Null when none is working.
 */
export function agentHold(agents: readonly Named[], action: string): string | null {
  const who = agents.filter((a) => a.status === "working");
  if (who.length === 0) return null;
  const one = who.length === 1;
  const name = one ? (who[0]?.name ?? "An agent") : `${who.length} agents`;
  return `${name} ${one ? "is" : "are"} working here: ${action.toLowerCase()} now can mix with ${one ? "its" : "their"} changes`;
}

/** The most urgent thing to say (working, then waiting, then finished), or null when all are idle. */
export function agentNote(agents: readonly Named[]): AgentNote | null {
  for (const kind of ["working", "blocked", "done"] as const) {
    const who = agents.filter((a) => a.status === kind);
    if (who.length > 0) return say(kind, who);
  }
  return null;
}
