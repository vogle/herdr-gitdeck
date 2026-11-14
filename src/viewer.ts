// The viewer tab: a gitdeck pane in the main area showing what needs the whole
// width — a diff, a file to stage by line, a file's blame or history, the repo's
// statistics. The panel
// asks for it through the shared VIEWER_KEY value, so a restart shows it again.

import { div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, focused, panes, run, setShared, shared, spaces } from "herdr";
import { sameDiff, type Diff } from "./core/git/diff.ts";
import type { Git, Target } from "./core/git/runner.ts";
import { loadDiff } from "./core/history.ts";
import { hunkPick, picks, startPicks, togglePick, withFreshDiff, type LinePicks } from "./core/linePicks.ts";
import type { Pick } from "./core/stage.ts";
import { applyPicks, loadStageDiff } from "./core/staging.ts";
import { files } from "./changes.ts";
import { loadImagePair } from "./core/imageDiff.ts";
import { loadBlame, loadFileLog, type InspectView } from "./core/inspect.ts";
import {
  findViewerTab, liveDiff, parseReturn, parseViewer, RETURN_KEY, returnPoint, staleViewerTab, VIEWER_TAB_NAME, viewerBack, viewerKey, viewerShow, viewerFocused, viewerTitle, VIEWER_KEY,
  type ReturnPoint, type ViewerNav, type ViewerRequest,
} from "./core/panel.ts";
import { loadStatus } from "./core/scan.ts";
import { Signal } from "./core/signal.ts";
import { loadStats } from "./core/stats.ts";
import { diffBody } from "./ui/details.ts";
import { inspectPane } from "./ui/inspect.ts";
import { stagePane } from "./ui/stagePane.ts";
import { textButton, type Palette } from "./ui/style.ts";

/** Image diffs are written here (hidden, so writing doesn't reload the mod), under the app folder `image()` reads from. */
export const IMAGE_CACHE = "mods/gitdeck/.cache/images";
/** While an uncommitted diff is on screen, how often it is read again. */
const LIVE_EVERY_MS = 3_000;

/** Asks the viewer tab to show a request: switches to it, or opens it. */
export function openViewer(request: ViewerRequest): void {
  const from = returnPoint(focused(), panes(), parseReturn(shared(RETURN_KEY), spaces()));
  if (from) setShared(RETURN_KEY, from);
  setShared(VIEWER_KEY, request);
  const tab = findViewerTab(panes());
  if (tab) run("tab.select", { id: tab });
  else run("tab.new", { name: VIEWER_TAB_NAME, mod: "gitdeck", props: { viewer: true } });
}

/** Back to the tab the viewer was opened from, and the terminal that had focus there. */
function goBack(from: ReturnPoint | null): void {
  if (!from) return;
  run("tab.select", { id: from.tab });
  if (from.terminal) run("pane.focus", { terminal: from.terminal });
}

type Staging = { kind: "stage"; picks: LinePicks; busy: boolean; error: string | null };
type Shown = { kind: "diff"; diff: Diff } | Staging | { kind: "inspect"; view: InspectView } | { kind: "note"; text: string };

export class Viewer {
  nav: ViewerNav = { current: null, back: [] };
  /** The last shared value read, so a change is noticed once. */
  seen = "";
  shown: Shown | null = null;
  readonly wake = new Signal();
  /** Re-reads the shown uncommitted diff in place, without the loading blank. */
  readonly tick = new Signal();

  readonly git: Git;

  constructor(git: Git) {
    this.git = git;
  }

  init(cx: AsyncContext): void {
    cx.spawn(async (cx) => {
      for (;;) {
        await this.wake.wait();
        await this.load(cx);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await this.tick.wait();
        await this.refresh(cx);
      }
    });
    // Only while the tab is looked at: a hidden one costs no git calls.
    cx.timer.every(LIVE_EVERY_MS, () => {
      if (liveDiff(this.nav.current) && viewerFocused(focused(), panes())) this.tick.fire();
    });
    const stale = staleViewerTab(spaces(), panes());
    if (stale) run("tab.rename", { id: stale, name: VIEWER_TAB_NAME });
    this.notice();
  }

  /** A new request from the panel starts over. Cheap: called from render. */
  notice(): void {
    const request = parseViewer(shared(VIEWER_KEY));
    const key = viewerKey(request);
    if (key === this.seen) return;
    this.seen = key;
    if (request && key !== viewerKey(this.nav.current)) {
      this.nav = viewerShow(this.nav, request, false);
      this.wake.fire();
    }
  }

  /** From inside the viewer (blame of the shown diff): back returns here. */
  go(request: ViewerRequest, cx: Context): void {
    this.move(viewerShow(this.nav, request, true), cx);
  }

  back(cx: Context): void {
    this.move(viewerBack(this.nav), cx);
  }

  private move(nav: ViewerNav, cx: Context): void {
    this.nav = nav;
    this.seen = viewerKey(nav.current);
    if (nav.current) setShared(VIEWER_KEY, nav.current);
    this.wake.fire();
    cx.notify();
  }

  async load(cx: AsyncContext): Promise<void> {
    const request = this.nav.current;
    if (!request) return;
    this.shown = null;
    cx.notify();
    const shown = await this.read(request);
    if (this.nav.current === request) this.shown = shown;
    cx.notify();
  }

  private async read(r: ViewerRequest): Promise<Shown> {
    const target: Target = { cwd: r.repo, on: r.on };
    if (r.view === "stats") return { kind: "inspect", view: { kind: "stats", data: await loadStats(this.git, target) } };
    if (r.view !== "diff" && r.view !== "stage") {
      const view: InspectView =
        r.view === "blame"
          ? { kind: "blame", path: r.path, rev: r.rev, data: await loadBlame(this.git, target, r.rev, r.path) }
          : { kind: "file-log", path: r.path, rev: r.rev, data: await loadFileLog(this.git, target, r.rev, r.path) };
      return { kind: "inspect", view };
    }
    if (r.view === "stage" || r.source.kind !== "commit") {
      // A work-tree diff runs the repo's clean filters: ask for its trust again here.
      const status = await loadStatus(this.git, target);
      if (!status.status || status.untrusted) return { kind: "note", text: "Work-tree diffs are not read for this repo: its own config names filter programs." };
    }
    if (r.view === "stage") return { kind: "stage", picks: startPicks(await loadStageDiff(this.git, target, r.path, r.staged)), busy: false, error: null };
    const source = r.source;
    const [diff, images] = await Promise.all([
      loadDiff(this.git, target, source),
      source.kind === "commit"
        ? loadImagePair(this.git, exec, target, source, { abs: `${appHome()}/${IMAGE_CACHE}`, rel: IMAGE_CACHE })
        : Promise.resolve(null),
    ]);
    return { kind: "diff", diff: { ...diff, images } };
  }

  /** The shown uncommitted diff, read again: redrawn only when it changed, and dropped if the view moved on. */
  async refresh(cx: AsyncContext): Promise<void> {
    const request = this.nav.current;
    const before = this.shown;
    if (!request || !liveDiff(request) || (before?.kind !== "diff" && before?.kind !== "stage")) return;
    const after = await this.read(request);
    if (this.nav.current !== request || this.shown !== before) return;
    if (after.kind === "diff" && before.kind === "diff" && sameDiff(after.diff, before.diff)) return;
    if (after.kind === "stage" && before.kind === "stage") {
      // The same lines keep their picks; a changed diff starts the picking over.
      const kept = withFreshDiff(before.picks, after.picks.diff);
      if (kept === before.picks) return;
      this.shown = { ...before, picks: kept };
    } else this.shown = after;
    cx.notify();
  }

  /** A row clicked in a file being staged by line: a hunk header does the hunk, a line is picked. */
  private stageClick(row: number, cx: Context): void {
    const s = this.shown;
    if (s?.kind !== "stage") return;
    const hunk = hunkPick(s.picks, row);
    if (hunk) return this.stage([hunk], cx);
    this.shown = { ...s, picks: togglePick(s.picks, row) };
    cx.notify();
  }

  /** Stages (or, on the staged side, unstages) the chosen lines, then reads the file again. */
  private stage(chosen: Pick[], cx: Context): void {
    const r = this.nav.current;
    const s = this.shown;
    if (r?.view !== "stage" || s?.kind !== "stage" || s.busy) return;
    this.shown = { ...s, busy: true, error: null };
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await applyPicks(this.git, files, { cwd: r.repo, on: r.on }, s.picks.diff.raw, chosen, r.staged);
      if (this.nav.current !== r) return;
      const after = await this.read(r);
      if (this.nav.current !== r) return;
      this.shown = after.kind === "stage" ? { ...after, error } : after;
      cx.notify();
    });
  }

  private bar(r: ViewerRequest, p: Palette): Element {
    const commit = r.view === "diff" && r.source.kind === "commit" ? r.source : null;
    const inspect = (view: "blame" | "file-log") => (cx: Context) =>
      commit && this.go({ view, repo: r.repo, on: r.on, rev: commit.hash, path: commit.path }, cx);
    const fileButtons = commit
      ? [textButton("viewer-blame", "Blame", p, inspect("blame")), textButton("viewer-history", "History", p, inspect("file-log"))]
      : liveDiff(r)
        ? // Read again every few seconds anyway; this is for right now.
          [textButton("viewer-reload", "Reload", p, () => this.tick.fire())]
        : [];
    const from = parseReturn(shared(RETURN_KEY), spaces());
    const side = r.view === "diff" && r.source.kind === "index" ? (r.source.staged ? "Staged: " : "Unstaged: ") : "";
    const where =
      r.view === "diff"
        ? `${side}${r.source.path}`
        : r.view === "stats"
          ? r.repo
          : r.view === "stage"
            ? `${r.staged ? "Staged" : "Unstaged"}: ${r.path}`
            : `${r.path} at ${r.rev.slice(0, 10)}`;
    return h_flex()
      .h(32)
      .px(8)
      .gap(6)
      .items_center()
      .flex_shrink_0()
      .border_b_1()
      .border_color(p.border)
      .bg(p.chrome)
      .when(from !== null, (el) => el.child(textButton("viewer-return", "← Terminal", p, () => goBack(from))))
      .when(this.nav.back.length > 0, (el) => el.child(textButton("viewer-back", "← Back", p, (cx) => this.back(cx))))
      .child(div().flex_shrink_0().font_medium().child(viewerTitle(r)))
      .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(where))
      .children(fileButtons);
  }

  render(p: Palette): Element {
    this.notice();
    const r = this.nav.current;
    if (!r) return div().p(16).text_color(p.dim).child("Nothing to show yet: open a file from the gitdeck panel.");
    const s = this.shown;
    const body =
      s === null
        ? div().p(12).text_color(p.dim).child("Reading…")
        : s.kind === "note"
          ? div().p(12).text_color(p.changed).child(s.text)
          : s.kind === "diff"
            ? diffBody(s.diff, p)
            : s.kind === "stage"
            ? stagePane({ picks: s.picks, staged: r.view === "stage" && r.staged, local: r.on === null, busy: s.busy, error: s.error }, p, {
                click: (row, cx) => this.stageClick(row, cx),
                apply: (cx) => this.stage(picks(s.picks), cx),
              })
            : inspectPane(s.view, p, { jump: () => {}, close: () => run("tab.close"), openTreeFile: () => {}, closeTreeFile: () => {} });
    return v_flex().flex_1().min_h_0().child(this.bar(r, p)).child(body);
  }
}
