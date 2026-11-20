// The Changes tab's stash controls: putting the changes aside asks first, and so
// do popping and dropping an entry; applying one leaves the stash in place and runs at once.

export type StashVerb = "apply" | "pop" | "drop";

/** The confirmation key of the Stash button. */
export const STASH_PUSH = "stash-push";

/** One entry's action, as the key a second click must match. */
export const stashKey = (verb: StashVerb, name: string): string => `stash-${verb}:${name}`;

export const stashPrompt = (changes: number): string => `Stash ${changes} change${changes === 1 ? "" : "s"}?`;

/** "ask" turns the button into its question; "run" does it. */
export function stashStep(confirm: string | null, key: string): "ask" | "run" {
  if (key.startsWith("stash-apply:")) return "run";
  return confirm === key ? "run" : "ask";
}

const LABEL: Record<StashVerb, string> = { apply: "Apply", pop: "Pop", drop: "Drop" };

export const stashEntryLabel = (verb: StashVerb, asking: boolean): string => `${LABEL[verb]}${asking ? "?" : ""}`;
