// Which folder gitdeck follows: the focused terminal's, else a terminal in the
// same tab, else the space's folder. Typed structurally so it can be tested
// without the Herdr runtime.

import type { Target } from "./git/runner.ts";

export interface FocusLike {
  space: string;
  tab: string;
  cwd: string | null;
}

export interface PaneLike {
  tab: string;
  terminal: string | null;
  cwd: string | null;
}

export interface SpaceLike {
  id: string;
  active: boolean;
  folder: string;
  machine: string | null;
}

export function contextOf(focus: FocusLike | null, panes: readonly PaneLike[], spaces: readonly SpaceLike[]): Target | null {
  const space = (focus ? spaces.find((s) => s.id === focus.space) : undefined) ?? spaces.find((s) => s.active);
  if (!space) return null;
  const on = space.machine;
  if (focus?.cwd) return { cwd: focus.cwd, on };
  const inTab = focus ? panes.find((p) => p.tab === focus.tab && p.terminal !== null && p.cwd) : undefined;
  if (inTab?.cwd) return { cwd: inTab.cwd, on };
  return space.folder ? { cwd: space.folder, on } : null;
}

export function sameContext(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  return a.cwd === b.cwd && a.on === b.on;
}
