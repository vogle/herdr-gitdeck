# githerd

A Herdr desktop-app mod (git client), written in TypeScript and bundled to one
`main.js`. Read `docs/DEVELOPMENT.md` before changing code: it lists the Herdr
runtime rules (no Node APIs, never keep a `cx`, no work in `render`, exec has
no stdin and a 30 s limit).

- Logic in `src/core` (pure, injected `Git`/`Exec`), test-first, 80% coverage gate.
- State is immutable (`src/core/herd.ts`): return new objects.
- Check every change: `pnpm verify`, then `pnpm dev`, `herdr-app status`, a screenshot.
- Herdr's own reference: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`.
