# Security

## Reporting a vulnerability

Please report security issues privately through GitHub:
**[Report a vulnerability](https://github.com/vogle/herdr-gitdeck/security/advisories/new)**
(Security tab → Report a vulnerability). Don't open a public issue for them.

Include what you found, how to reproduce it, and which version you saw it in.

## Supported versions

Only the latest release gets fixes. GitDeck offers its own updates
(see [Updates](#updates)), so staying current takes one click.

## Updates

GitDeck checks this repo's latest GitHub release once a day. A newer release
is installed only when you click its notification or run
`herdr-app do gitdeck.update`. It downloads `gitdeck.tar.gz` only from
`github.com/vogle/herdr-gitdeck/releases/download/`, checks it with
`herdr-app check` when available, and swaps it in. A failure leaves the
installed version unchanged.

## What GitDeck runs

GitDeck is a Herdr mod. Through Herdr's `exec` it runs `git` in the repos you
open, `gh` or `glab` for pull-request data, and, only when you ask it to
suggest a commit message, the agent CLI you pick (`claude` or `codex`) with
the staged diff. It reaches the network for `git fetch`/`push`/`pull` that you
start, for pull-request data, and for the daily release check above.
