# Developing githerd

## Layout

```
src/
  core/            pure logic, no Herdr imports: tested with Node
    git/runner.ts    the only place git runs (createGit over an injected exec)
    git/status.ts    `git status --porcelain=v2` parser and summary
    repos/discover.ts  find the herd root, list repos below it
    scan.ts          scanHerd / loadStatus (git + find, injected)
    herd.ts          the panel's state: immutable, every change returns a new one
    context.ts       which folder to follow (focus → tab terminal → space)
    paths.ts pool.ts signal.ts   small helpers
  ui/              views: functions from state to gpui-kit elements
  main.ts          the View: wires Herdr's live data, the git task and the views
mod/               mod.json and icons, copied next to the bundle
scripts/           build (esbuild), dev-install (atomic swap), sync-types
tests/             node:test, including real git/find integration tests
```

## Loop

```sh
pnpm test        # node --test (Node runs the .ts directly)
pnpm coverage    # same, failing under 80% lines/branches/functions of src/core
pnpm typecheck   # the mod against the app's types, and the tests
pnpm dev         # build, `herdr-app check` in a hidden folder, swap in
pnpm verify      # typecheck + coverage + build
```

Write the test first. Logic goes in `src/core` behind injected `Git`/`Exec`, so
it can be tested without Herdr; `src/ui` stays thin. After `pnpm dev`, look at
it: `herdr-app shot /tmp/x.png`, and `herdr-app status` must show no errors.
Commands reach a shown copy: `herdr-app do githerd.picker`.

## Herdr rules that bite

- Herdr runs **`main.js` only** (QuickJS): TypeScript is bundled by esbuild
  into one file. `herdr`, `gpui-kit`, `gpui-base` are provided at run time
  (externals). No Node APIs, no `setTimeout`, no DOM.
- **Never keep a `cx`.** Every callback and task gets its own.
- **Never start work in `render()`.** It notices a change (`notice()`) and
  fires the `Signal` that the git task started in `init` waits on.
- `.when(cond, …)` needs a real boolean.
- `exec`: an argument array (no shell), 30 s limit, 8 MiB output, **no stdin**.
  Anything that needs input writes a file first (`writeTextFile`, under
  `~/.config/herdr-app`). Long operations (clone, big push) belong in a
  terminal (`hc`), not `exec`.
- Every git call uses `--no-optional-locks`, so githerd never blocks an
  agent's git in the same repo.
- Each saved file reloads the mod, and herdr-app 0.1.x keeps old code alive per
  reload: install with `scripts/dev-install.sh` (one rename), never by copying
  files one at a time.
- A command sent while a freshly reloaded copy isn't yet waiting on
  `nextCommand()` is lost; send it again.
- `types/` comes from the installed app (`pnpm types`) and isn't committed:
  it must match the app version you run.

## Release (later)

Semver in `package.json`; tag `vX.Y.Z`; a GitHub release with the built
`dist/githerd` folder. For herdr.dev/mods: a public repo with the topic
`herdr-mod`, a `RECIPE.md` and a `preview.png`.
