# githerd

A git client for the [Herdr](https://herdr.dev) desktop app, built for working
with **a herd of repositories** at once: a folder of services, a monorepo of
sub-repos, or one plain repo.

githerd follows the terminal you're focused on. It climbs to the outermost
repository around that folder, lists every repository below it, and shows the
one you're in, with its branch and where it stands.

> Status: **M0**. Repo discovery, the repo picker and per-repo status. The
> commit graph, staging and branch work come next (see [Roadmap](#roadmap)).

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
- **Summary.** The shown repo's folder, HEAD, upstream and changed files.

It only reads: `git status`, `git rev-parse` and `find`. Nothing is written to
your repositories, and nothing goes over the network.

## Commands

Bind them in `keys.json` or run them with `herdr-app do`:

| Command | Does |
|---|---|
| `githerd.picker` | open or close the repo picker |
| `githerd.refresh` | scan the herd again |

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
| **M1** | Commit graph, commit details and diff, branches/tags/stashes sidebar, search |
| **M2** | Staging by file, hunk and line; commit and amend; discard; recent messages |
| **M3** | Checkout, merge, rebase, cherry-pick, revert, reset, stash; fetch/pull/push |
| **M4** | Interactive rebase, conflict resolver, blame, file history, tree at a commit, reflog, image diff |
| **M5** | Submodules, git-flow, LFS, GitHub integration, repository statistics |
