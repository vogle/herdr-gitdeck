// Whether a repo is safe to read without asking. A repo's own config (a
// downloaded archive's `.git/config`, or a file it includes) can name a
// clean/smudge/process filter, and `git status` runs that program on any
// changed file `.gitattributes` routes through it. Reading config never runs
// anything, so githerd looks first and leaves such a repo alone.

/** Every filter command with the scope it came from (an include reports its includer's scope). */
export const FILTER_CHECK_ARGS: readonly string[] = ["config", "--show-scope", "--get-regexp", "^filter\\..+\\.(clean|smudge|process)$"];

/** The person's own settings (system, global, `-c`) are trusted; the repo's are not. */
const REPO_SCOPES: ReadonlySet<string> = new Set(["local", "worktree"]);

/** The filter keys the repo itself sets, each once, in the order found. */
export function repoFilterCommands(output: string): string[] {
  const keys = output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([scope = "", rest = ""]) => REPO_SCOPES.has(scope) && rest !== "")
    .map(([, rest = ""]) => rest.split(" ")[0] ?? "");
  return [...new Set(keys)];
}
