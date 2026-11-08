// The one place githerd runs git. Everything else asks through a `Git`,
// so the logic can be tested with a fake and the engine swapped later.

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Herdr's `exec` (or a fake): runs a program in a folder, on a machine (null: this one). */
export type Exec = (command: string, args: string[], options: { cwd?: string; on?: string | null }) => Promise<ExecResult>;

/** Where a git command runs. */
export interface Target {
  cwd: string;
  on: string | null;
}

/** Runs `git <args>` at a target; resolves with stdout, rejects with a GitError. */
export type Git = (target: Target, args: string[]) => Promise<string>;

/**
 * Applied to every call:
 * - no optional locks, so reading never blocks an agent's git in the same repo;
 * - plain output: no colors, paths unquoted (UTF-8 names stay readable);
 * - no fsmonitor: githerd reads every repo `find` turns up, and a repo's own
 *   `.git/config` could name a program as its fsmonitor and have it run;
 * - literal paths: a file named `:(glob)*` means that file, not a pattern
 *   (discarding it must never reach other files);
 * - no signature checks: a repo's `log.showSignature` would make every
 *   log-like command (log, show, stash list) run its `gpg.program`.
 */
export const GIT_FLAGS: readonly string[] = [
  "--no-optional-locks",
  "--literal-pathspecs",
  "-c",
  "color.ui=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "log.showSignature=false",
];

export class GitError extends Error {
  readonly args: readonly string[];
  /** The exit code, or -1 when git couldn't start (not installed, folder gone, machine unreachable). */
  readonly code: number;
  readonly stderr: string;
  /** What git printed anyway: `diff --no-index` exits 1 with the diff on stdout. */
  readonly stdout: string;

  constructor(message: string, args: readonly string[], code: number, stderr: string, stdout = "") {
    super(message);
    this.name = "GitError";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

/** `env` settings (NAME=value) put git through `env`: Herdr's exec takes none of its own. */
export function createGit(exec: Exec, env: readonly string[] = []): Git {
  return async (target, args) => {
    let result: ExecResult;
    const command = [...GIT_FLAGS, ...args];
    try {
      result = await (env.length > 0
        ? exec("env", [...env, "git", ...command], { cwd: target.cwd, on: target.on })
        : exec("git", command, { cwd: target.cwd, on: target.on }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitError(message, args, -1, "");
    }
    if (result.code !== 0) {
      const first = result.stderr.split("\n").find((line) => line.trim() !== "");
      throw new GitError(first?.trim() ?? `git ${args.join(" ")} exited ${result.code}`, args, result.code, result.stderr, result.stdout);
    }
    return result.stdout;
  };
}
