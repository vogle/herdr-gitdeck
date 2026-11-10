// githerd as a right-side panel: the drill-down's back step, the wide breakpoint,
// and the viewer tab that shows what needs the whole width (diffs, blame, stats).
// The panel asks for a view by writing a request to a shared value; the viewer
// tab (a githerd pane in the main area) reads it.

import type { DiffSource } from "./history.ts";

/** The shared value carrying what the viewer tab shows. */
export const VIEWER_KEY = "githerd.viewer";
/** Panel widths from here up get two columns. */
export const WIDE_PX = 640;

export type PanelTab = "changes" | "history" | "branches" | "more";
export const PANEL_TABS: readonly PanelTab[] = ["changes", "history", "branches", "more"];

export const isWide = (width: number): boolean => width >= WIDE_PX;

export type BackStep = "inspect" | "file" | "commit";

/** What one press of back (or Esc) closes: the innermost level open. */
export function backStep(s: { inspect: boolean; file: string | null; selected: string | null }): BackStep | null {
  if (s.inspect) return "inspect";
  if (s.file !== null) return "file";
  if (s.selected !== null) return "commit";
  return null;
}

interface Where {
  repo: string;
  on: string | null;
}

export type ViewerRequest =
  | (Where & { view: "diff"; source: DiffSource })
  | (Where & { view: "blame" | "file-log"; rev: string; path: string })
  | (Where & { view: "stats" });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

function parseSource(v: unknown): DiffSource | null {
  if (!isObj(v) || !isText(v.path)) return null;
  if (v.kind === "untracked") return { kind: "untracked", path: v.path };
  if (v.kind === "index") return typeof v.staged === "boolean" ? { kind: "index", path: v.path, staged: v.staged } : null;
  if (v.kind === "worktree") return typeof v.hasHead === "boolean" ? { kind: "worktree", path: v.path, hasHead: v.hasHead } : null;
  if (v.kind !== "commit" || !isText(v.hash) || !Array.isArray(v.parents) || !v.parents.every(isText)) return null;
  if (v.oldPath !== null && !isText(v.oldPath)) return null;
  return { kind: "commit", hash: v.hash, parents: [...v.parents], path: v.path, oldPath: v.oldPath };
}

/** A request read back from shared state: checked field by field, unknown fields dropped. */
export function parseViewer(v: unknown): ViewerRequest | null {
  if (!isObj(v) || !isText(v.repo) || !v.repo.startsWith("/")) return null;
  if (v.on !== null && !isText(v.on)) return null;
  const where: Where = { repo: v.repo, on: v.on };
  if (v.view === "stats") return { ...where, view: "stats" };
  if (v.view === "blame" || v.view === "file-log") {
    return isText(v.rev) && isText(v.path) ? { ...where, view: v.view, rev: v.rev, path: v.path } : null;
  }
  if (v.view !== "diff") return null;
  const source = parseSource(v.source);
  return source ? { ...where, view: "diff", source } : null;
}

/** Equal requests give equal keys (fields in a fixed order). */
export function viewerKey(r: ViewerRequest | null): string {
  if (!r) return "";
  const parsed = parseViewer(r);
  return parsed ? JSON.stringify(parsed) : "";
}

const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function viewerTitle(r: ViewerRequest): string {
  if (r.view === "diff") return base(r.source.path);
  if (r.view === "blame") return `Blame ${base(r.path)}`;
  if (r.view === "file-log") return `History ${base(r.path)}`;
  return `Stats ${base(r.repo)}`;
}

/** What the viewer shows, and where its back button returns to. */
export interface ViewerNav {
  current: ViewerRequest | null;
  back: readonly ViewerRequest[];
}

/** From the panel: a fresh start. From inside the viewer (blame of the shown diff): back returns. */
export function viewerShow(nav: ViewerNav, request: ViewerRequest, inside: boolean): ViewerNav {
  if (!inside || !nav.current) return { current: request, back: [] };
  return { current: request, back: [...nav.back, nav.current] };
}

export function viewerBack(nav: ViewerNav): ViewerNav {
  const previous = nav.back.at(-1);
  return previous ? { current: previous, back: nav.back.slice(0, -1) } : nav;
}

/** The tab holding the viewer: layout blocks are not panes, so a githerd pane is the viewer. */
export function findViewerTab(panes: readonly { mod?: string; tab: string }[]): string | null {
  return panes.find((p) => p.mod === "githerd")?.tab ?? null;
}

/** Focus is in the viewer's tab: it has no terminal, so the panel keeps the repo it shows. */
export function viewerFocused(focus: { tab: string } | null, panes: readonly { mod?: string; tab: string }[]): boolean {
  return focus !== null && panes.some((p) => p.tab === focus.tab && p.mod === "githerd");
}

/** The viewer tab's name. */
export const VIEWER_TAB_NAME = "GitHerd";
/** What the viewer tab was named before. */
const OLD_VIEWER_TAB_NAME = "githerd";

/** A viewer tab opened under the old lowercase name, to rename (one the person renamed is left alone). */
export function staleViewerTab(
  spaces: readonly { tabs: readonly { id: string; name: string }[] }[],
  panes: readonly { mod?: string; tab: string }[],
): string | null {
  const viewer = findViewerTab(panes);
  const tab = spaces.flatMap((s) => s.tabs).find((t) => t.id === viewer);
  return tab?.name === OLD_VIEWER_TAB_NAME ? tab.id : null;
}
