# gitdeck

A git client for the [Herdr](https://herdr.dev) desktop app, built for working
with **a herd of repositories** at once: a folder of services, a monorepo of
sub-repos, or one plain repo.

gitdeck follows the terminal you're focused on. It climbs to the outermost
repository around that folder, lists every repository below it, and shows the
one you're in, with its branch and where it stands.

> Status: **M5**. Repo discovery, the repo picker, the history (commit graph,
> commit details and diffs, search), staging and committing, and
> branch work and sync, blame, file history, the reflog, the files at a commit,
> squashing commits and GitHub/GitLab review requests
> (see [Roadmap](#roadmap)).

## What it does now

- **Follows focus.** The focused terminal's folder, else a terminal in the same
  tab, else the space's folder. Spaces on another machine run git there.
- **Finds the herd.** From `bsp/bsp-bo`, the herd is `bsp` and all its
  sub-repos, not just `bsp-bo`. It searches 3 folders deep (`gitdeck.depth`,
  1 to 6) and never enters hidden folders, `node_modules`, `vendor`,
  `target`, `dist`, `build`, `Pods` or `DerivedData`. A home folder that isn't
  a repo is never searched.
- **Header.** The shown repo (a dropdown when there are several), its branch,
  and counts: `!` conflicts, `●` staged (green) and changed (yellow), `?`
  untracked, `↑` to push, `↓` to pull. ⟳ scans again.
- **Picker.** Every repo grouped by folder, the root first, each with its
  branch and counts. Click one to show it.
- **Three tabs.** **Changes** (what's uncommitted, staging and stashes),
  **Review** (the branch's diff, checks and pull request) and **History**.
  A keys.json binding to a tab gitdeck no longer has opens Changes.
- **History.** The shown repo's commit graph over every branch, remote branch
  and tag (500 commits, then "Show older commits"), with uncommitted changes
  as a dashed row on top. Click a commit for its message and changed files,
  a file for its diff. The search box filters by subject, author, branch, tag or hash.
- **Staging.** Click the uncommitted row: staged and unstaged files, each with
  Stage / Unstage, and Discard (a second click confirms; an untracked file is
  deleted). Click a file for one side of its diff: click a hunk header to
  stage (or unstage) that hunk, or pick lines and stage just those. Write a
  message and Commit, or tick Amend to rewrite the last commit (its message
  is filled in). Conflicted files can be marked resolved.
- **Branches and sync.** A bar above the graph: Fetch (every remote), Pull,
  Push (a branch without an upstream goes to `origin` and tracks it), and
  Stash (every change, untracked files too). Select a commit for its actions:
  check it out, new branch or tag here, cherry-pick, revert, merge or rebase
  onto it, reset to it (soft, mixed, or hard after a second click), and for
  each branch on it: switch to, merge, rebase onto, delete. A stash offers
  apply, pop and drop. A merge, rebase, cherry-pick or revert that stops on
  conflicts shows a banner with Continue, Skip and Abort.
- **Image diff.** A commit's changed PNG, JPEG, GIF, WebP, BMP or ICO shows
  its before and after side by side above the diff. Each version is written
  from git's objects (`git cat-file`, so no filter runs) into
  `mods/gitdeck/.cache/images/`, named by its object id, up to 20 MB. Repos on
  this machine only.
- **Looking closer.** A committed file's diff has **Blame** (each line's
  commit, author and age) and **History** (the commits that changed it,
  following renames). **Reflog** lists where HEAD has been. A click on any of
  their rows jumps to that commit. A conflicted file can **Take ours** or
  **Take theirs** whole, or **Resolve…** it block by block: each conflict
  shows both sides and keeps Ours, Theirs or Both, then Save writes the file
  (only if it hasn't changed since) and stages it. **Files at commit** lists every file as it was at the
  selected commit; click one to read it (raw, from git's objects). A Git LFS
  file shows its real size and object id; a submodule shows the commit it
  records and its URL (from that commit's `.gitmodules`, read as plain text).
- **Squashing history.** "Squash later commits into this" folds every commit
  after the selected one into it, keeping its message, after one confirmation
  (`Squash N commits into <hash>?`). gitdeck writes git's todo list itself (no
  editor opens). Ranges with a merge commit are refused. Repos on this machine only.
- **GitHub and GitLab.** **Review → All pull requests** lists the repo's
  PRs (GitHub, through `gh`) or MRs (GitLab, through `glab`): open, merged
  and closed, the latest 100, read-only. A click jumps to the head commit.
  gitdeck reads the project from `origin` and runs the CLI with `--repo`
  outside the repo, so it never reads the work tree; sign in once with
  `gh auth login` or `glab auth login`. Only github.com and gitlab.com are
  recognised on their own; for your own host, set
  `git config gitdeck.forge gitlab` (or `github`) in that repo.
- **Agent sessions.** A commit's pane names the agent conversations behind
  it. Recorded links come from [Entire](https://github.com/entireio/cli)
  checkpoints (`refs/entire/checkpoints/…`, only their small metadata and
  prompt files) and [Git AI](https://github.com/git-ai-project/git-ai) notes
  (`refs/notes/ai`); History marks those commits. Without a record, gitdeck
  estimates from Claude Code (`~/.claude/projects/`) and Codex
  (`~/.codex/sessions/`) logs: a session in this repo or one of its worktrees
  that edited, or named in a shell command, one of the commit's files between
  its parent and itself. Estimates say so and are never marked in History.
  **Blame** names the agent on each line a Git AI note records. On a space on
  another machine, that machine's records are read. A source that can't be
  read is skipped. Set the shared value `gitdeck.agentLink` to `"off"` to read
  none of them.

Reading uses `git status`, `git log`, `git show -s`, `git diff-tree`,
`git diff`, `git for-each-ref`, `git stash list`, `git rev-parse`, `git blame`
(of a commit, never the work tree), `git ls-tree`, `git cat-file`, `git ls-files`,
`git notes` and `find`, and `perl` reads agent logs from where it last stopped.
Only the buttons you click write: `git add`, `git restore`, `git rm --cached`,
`git clean` (discarding an untracked file), `git apply --cached` (hunks and
lines, from a patch file gitdeck writes into the repo's `.git` folder) and
`git commit`, and the branch and sync buttons run `git switch`, `branch`,
`tag`, `merge`, `rebase`, `cherry-pick`, `revert`, `reset`, `stash`, `fetch`,
`pull` and `push`, and Squash runs `git rebase -i` with its todo list
copied in by `cp` (`sequence.editor`). These run your repo's own hooks and signing program, as git
always does, so use them only in repos whose `.git` folder you trust. Network
commands never ask for a password (`GIT_TERMINAL_PROMPT=0`): use an SSH key or
a credential helper. Nothing is ever force-pushed. Paths are
always literal (`--literal-pathspecs`): a file named `:(glob)*` is just that
file. The patch file gets a fresh name each time and is deleted after use.
Only Fetch, Pull, Push and the PRs list go over the network.

Partial staging (hunks and lines) works for repos on this machine only: a
remote machine's repo can still stage whole files and commit.

A repository's own `.git/config` can name programs for git to run. gitdeck
never lets it: no fsmonitor, no signature checks (`gpg.program`), no external
diff or textconv, no submodules, and a repo whose config names filter programs
gets no status or work-tree diff until you've looked at it yourself.

## Commands

Bind them in `keys.json` or run them with `herdr-app do`:

| Command | Does |
|---|---|
| `gitdeck.picker` | open or close the repo picker |
| `gitdeck.refresh` | scan the herd again |
| `gitdeck.search` | put the keyboard in the history search box |

## Install (development)

```sh
pnpm install
pnpm types   # copy the installed Herdr app's type files into types/
pnpm dev     # build, check and install into ~/.config/herdr-app/mods/gitdeck
```

Then show it, for example beside a terminal:

```sh
herdr-app do pane.split '{"direction":"right","mod":"gitdeck"}'
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how the code is laid out and
the rules a Herdr mod has to follow.

## Roadmap

| | |
|---|---|
| **M0** | Foundation: TS build, tests, install, git layer, herd discovery, picker ✅ |
| **M1** | Commit graph, commit details and diff, search ✅ · removed: the refs sidebar |
| **M2** | Staging by file, hunk and line; commit and amend; discard ✅ |
| **M3** | Checkout, merge, rebase, cherry-pick, revert, reset, stash; fetch/pull/push ✅ |
| **M4** | Blame, file history, reflog, take ours/theirs, block-by-block conflict resolver, files at a commit, image diff ✅ · removed: the interactive rebase step editor (replaced by "Squash later commits into this") |
| **Agents** | Agent sessions from Entire checkpoints, Git AI notes, and Claude Code and Codex logs; Blame line marks ✅ |
| **M5** | GitHub pull requests (read-only), submodules and Git LFS shown read-only ✅. Updating submodules and fetching LFS content are left out: both run programs a repo names · removed: repository statistics, git-flow start |
