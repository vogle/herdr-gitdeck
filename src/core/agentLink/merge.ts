import type { AgentSession } from "./types.ts";

/** One session per id, taken from the first list that has it: pass the sources in order Entire, Git AI, logs. */
export function mergeSessions(lists: readonly (readonly AgentSession[])[]): AgentSession[] {
  const seen = new Set<string>();
  return lists.flat().filter((session) => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return true;
  });
}
