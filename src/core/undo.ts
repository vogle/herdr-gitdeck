// Undo the last commit: move HEAD back one commit and keep its changes staged,
// so a commit made too early (an agent wasn't done) can be redone. Refused for a
// commit already on a remote, where undoing would rewrite shared history.

import type { Git, Target } from "./git/runner.ts";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const REMOTE_PREFIX = "refs/remotes/";

/** Returns an error text, or null when HEAD moved back with the changes still staged. */
export async function undoLastCommit(git: Git, target: Target): Promise<string | null> {
  try {
    await git(target, ["rev-parse", "--verify", "-q", "HEAD~1"]);
  } catch {
    return "The first commit can't be undone here";
  }
  try {
    const refs = (await git(target, ["for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/remotes"])).trim();
    const first = refs.split("\n")[0] ?? "";
    if (first !== "") {
      return `This commit is already on ${first.slice(REMOTE_PREFIX.length)}: undoing it would rewrite pushed history`;
    }
    await git(target, ["reset", "--soft", "HEAD~1"]);
    return null;
  } catch (error) {
    return message(error);
  }
}
