// What links a commit to the agent conversation that wrote it.

/** Where a link came from: a recorded checkpoint or note, or a guess from a log. */
export type Source = "entire" | "git-ai" | "claude" | "codex";

/** Recorded links are exact; ones read off a log's times and files are guesses. */
export type Confidence = "exact" | "guess";

export interface AgentSession {
  /** The agent's own session id, the key that merges one session found in several sources. */
  id: string;
  source: Source;
  confidence: Confidence;
  /** "Claude Code", "Codex". */
  agent: string;
  model: string | null;
  /** Seconds since the epoch. */
  time: number;
  tokens: number | null;
  /** The user's prompt, read only when the commit is opened. */
  prompt: string | null;
  /** Lines in the commit the session wrote, when a source records them (Git AI). */
  lines?: number;
  /** Files of the commit a guessed session edited, and others its shell commands only named. */
  overlap?: number;
  named?: number;
}
