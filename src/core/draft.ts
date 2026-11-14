// A commit message drafted from the staged files ("Update header.ts and main.ts"),
// so the box is never empty when there is something to commit. The draft follows
// the staged files until the person writes their own message.

import type { ChangeFile } from "./staging.ts";

/** Names listed before the rest are counted. */
const LISTED = 3;

const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function verb(files: readonly ChangeFile[]): string {
  const all = (letters: string) => files.every((f) => letters.includes(f.letter));
  if (all("A?")) return "Add";
  if (all("D")) return "Remove";
  if (all("R")) return "Rename";
  return "Update";
}

function names(files: readonly ChangeFile[]): string {
  const shown = files.slice(0, LISTED).map((f) => base(f.path));
  const rest = files.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more file${rest === 1 ? "" : "s"}`;
  if (shown.length === 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

export function draftMessage(staged: readonly ChangeFile[]): string {
  return staged.length === 0 ? "" : `${verb(staged)} ${names(staged)}`;
}

/**
 * What the box should hold now, or null to leave it: an empty box or one still
 * holding our last draft follows the new draft; a message the person wrote, or
 * an amend (which starts from the last commit's message), is left alone.
 */
export function followDraft(box: string, lastDraft: string, draft: string, amend: boolean): string | null {
  if (amend || box === draft) return null;
  return box.trim() === "" || box === lastDraft ? draft : null;
}
