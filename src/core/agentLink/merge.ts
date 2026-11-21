import type { AgentSession } from "./types.ts";

/**
 * One session per id, taken from the first list that has it: pass the sources in order Entire, Git AI, logs.
 * A line count only a later source knows is kept.
 */
export function mergeSessions(lists: readonly (readonly AgentSession[])[]): AgentSession[] {
  const byId = new Map<string, AgentSession>();
  for (const session of lists.flat()) {
    const first = byId.get(session.id);
    if (first === undefined) byId.set(session.id, session);
    else if (first.lines === undefined && session.lines !== undefined) byId.set(session.id, { ...first, lines: session.lines });
  }
  return [...byId.values()];
}

/** A source that fails (no tool, another format, a timeout) is left out; the others still show. */
export const orNone = <T>(sessions: Promise<readonly T[]>): Promise<readonly T[]> => sessions.catch(() => []);

/** `gitdeck.agentLink`: "off" (or false) stops every read of agent records. */
export const AGENT_LINK_KEY = "gitdeck.agentLink";
export const agentLinkOn = (value: unknown): boolean => value !== "off" && value !== false;
