# githerd

A git client for the [Herdr](https://herdr.dev) desktop app, built for working
with **a herd of repositories** at once: a folder of services, a monorepo of
sub-repos, or one plain repo.

githerd follows the terminal you're focused on. It climbs to the outermost
repository around that folder, lists every repository below it, and shows the
one you're in, with its branch and where it stands.

> Status: **M3**. Repo discovery, the repo picker, the history (commit graph,
> commit details and diffs, refs sidebar, search), staging and committing, and
> branch work and sync. Interactive rebase, blame and the like come next (see
> [Roadmap](#roadmap)).

## What it does now

- **Follows focus.** The focused terminal's folder, else a terminal in the same
  tab, else the space's folder. Spaces on another machine run git there.
- **Finds the herd.** From `bsp/bsp-bo`, the herd is `bsp` and all its
  sub-repos, not just `bsp-bo`. It searches 3 folders deep (`githerd.depth`,
  1 to 6) and never enters hidden folders, `node_modules`, `vendor`,
  `target`, `dist`, `build`, `Pods` or `DerivedData`. A home folder that isn't
  a repo is never searched.
- **Header.** The shown repo (a dropdown when there are several), its branch,
  and counts: `!` conflicts, `●` staged (green) and changed (yellow), `?`
  untracked, `↑` to push, `↓` to pull. ⟳ scans again.
- **Picker.** Every repo grouped by folder, the root first, each with its
  branch and counts. Click one to show it.
- **History.** The shown repo's commit graph over every branch, remote branch
  and tag (500 commits, then "Show older commits"), with uncommitted changes
  as a dashed row on top. Click a commit for its message and changed files,
  a file for its diff. **Refs** opens a sidebar of branches (with ↑↓ against
  their upstream), remote branches, tags and stashes; a click jumps to the
  commit. The search box filters by subject, author, branch, tag or hash.
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
- **Looking closer.** A committed file's diff has **Blame** (each line's
  commit, author and age) and **History** (the commits that changed it,
  following renames). **Reflog** lists where HEAD has been. A click on any of
  their rows jumps to that commit. A conflicted file can **Take ours** or
  **Take theirs** whole.

Reading uses `git status`, `git log`, `git show -s`, `git diff-tree`,
`git diff`, `git for-each-ref`, `git stash list`, `git rev-parse`, `git blame`
(of a commit, never the work tree) and `find`.
Only the buttons you click write: `git add`, `git restore`, `git rm --cached`,
`git clean` (discarding an untracked file), `git apply --cached` (hunks and
lines, from a patch file githerd writes into the repo's `.git` folder) and
`git commit`, and the branch and sync buttons run `git switch`, `branch`,
`tag`, `merge`, `rebase`, `cherry-pick`, `revert`, `reset`, `stash`, `fetch`,
`pull` and `push`. These run your repo's own hooks and signing program, as git
always does, so use them only in repos whose `.git` folder you trust. Network
commands never ask for a password (`GIT_TERMINAL_PROMPT=0`): use an SSH key or
a credential helper. Nothing is ever force-pushed. Paths are
always literal (`--literal-pathspecs`): a file named `:(glob)*` is just that
file. The patch file gets a fresh name each time and is deleted after use.
Only Fetch, Pull and Push go over the network.

Partial staging (hunks and lines) works for repos on this machine only: a
remote machine's repo can still stage whole files and commit.

A repository's own `.git/config` can name programs for git to run. githerd
never lets it: no fsmonitor, no signature checks (`gpg.program`), no external
diff or textconv, no submodules, and a repo whose config names filter programs
gets no status or work-tree diff until you've looked at it yourself.

## Commands

Bind them in `keys.json` or run them with `herdr-app do`:

| Command | Does |
|---|---|
| `githerd.picker` | open or close the repo picker |
| `githerd.refresh` | scan the herd again |
| `githerd.search` | put the keyboard in the history search box |

## Install (development)

```sh
pnpm install
pnpm types   # copy the installed Herdr app's type files into types/
pnpm dev     # build, check and install into ~/.config/herdr-app/mods/githerd
```

Then show it, for example beside a terminal:

```sh
herdr-app do pane.split '{"direction":"right","mod":"githerd"}'
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how the code is laid out and
the rules a Herdr mod has to follow.

## Roadmap

| | |
|---|---|
| **M0** | Foundation: TS build, tests, install, git layer, herd discovery, picker ✅ |
| **M1** | Commit graph, commit details and diff, branches/tags/stashes sidebar, search ✅ |
| **M2** | Staging by file, hunk and line; commit and amend; discard ✅ |
| **M3** | Checkout, merge, rebase, cherry-pick, revert, reset, stash; fetch/pull/push ✅ |
| **M4** | Blame, file history, reflog, take ours/theirs ✅; interactive rebase, line-level conflict resolver, tree at a commit, image diff |
| **M5** | Submodules, git-flow, LFS, GitHub integration, repository statistics |
