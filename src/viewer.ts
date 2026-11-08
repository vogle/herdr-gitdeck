// The viewer tab: a githerd pane in the main area showing what needs the whole
// width — a diff, a file's blame or history, the repo's statistics. The panel
// asks for it through the shared VIEWER_KEY value, so a restart shows it again.

import { div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, panes, run, setShared, shared } from "herdr";
import type { Diff } from "./core/git/diff.ts";
import type { Git, Target } from "./core/git/runner.ts";
import { loadDiff } from "./core/history.ts";
import { loadImagePair } from "./core/imageDiff.ts";
import { loadBlame, loadFileLog, type InspectView } from "./core/inspect.ts";
import {
  findViewerTab, parseViewer, viewerBack, viewerKey, viewerShow, viewerTitle, VIEWER_KEY,
  type ViewerNav, type ViewerRequest,
} from "./core/panel.ts";
import { loadStatus } from "./core/scan.ts";
import { Signal } from "./core/signal.ts";
import { loadStats } from "./core/stats.ts";
import { diffBody } from "./ui/details.ts";
import { inspectPane } from "./ui/inspect.ts";
import { textButton, type Palette } from "./ui/style.ts";

/** Image diffs are written here (hidden, so writing doesn't reload the mod), under the app folder `image()` reads from. */
export const IMAGE_CACHE = "mods/githerd/.cache/images";

/** Asks the viewer tab to show a request: switches to it, or opens it. */
export function openViewer(request: ViewerRequest): void {
  setShared(VIEWER_KEY, request);
  const tab = findViewerTab(panes());
  if (tab) run("tab.select", { id: tab });
  else run("tab.new", { name: "GitHerd", mod: "githerd", props: { viewer: true } });
}

type Shown = { kind: "diff"; diff: Diff } | { kind: "inspect"; view: InspectView } | { kind: "note"; text: string };

export class Viewer {
  nav: ViewerNav = { current: null, back: [] };
  /** The last shared value read, so a change is noticed once. */
  seen = "";
  shown: Shown | null = null;
  readonly wake = new Signal();

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
    if (r.view !== "diff") {
      const view: InspectView =
        r.view === "blame"
          ? { kind: "blame", path: r.path, rev: r.rev, data: await loadBlame(this.git, target, r.rev, r.path) }
          : { kind: "file-log", path: r.path, rev: r.rev, data: await loadFileLog(this.git, target, r.rev, r.path) };
      return { kind: "inspect", view };
    }
    const source = r.source;
    if (source.kind !== "commit") {
      // A work-tree diff runs the repo's clean filters: ask for its trust again here.
      const status = await loadStatus(this.git, target);
      if (!status.status || status.untrusted) return { kind: "note", text: "Work-tree diffs are not read for this repo: its own config names filter programs." };
    }
    const [diff, images] = await Promise.all([
      loadDiff(this.git, target, source),
      source.kind === "commit"
        ? loadImagePair(this.git, exec, target, source, { abs: `${appHome()}/${IMAGE_CACHE}`, rel: IMAGE_CACHE })
        : Promise.resolve(null),
    ]);
    return { kind: "diff", diff: { ...diff, images } };
  }

  private bar(r: ViewerRequest, p: Palette): Element {
    const commit = r.view === "diff" && r.source.kind === "commit" ? r.source : null;
    const inspect = (view: "blame" | "file-log") => (cx: Context) =>
      commit && this.go({ view, repo: r.repo, on: r.on, rev: commit.hash, path: commit.path }, cx);
    const fileButtons = commit
      ? [textButton("viewer-blame", "Blame", p, inspect("blame")), textButton("viewer-history", "History", p, inspect("file-log"))]
      : [];
    const where = r.view === "diff" ? r.source.path : r.view === "stats" ? r.repo : `${r.path} at ${r.rev.slice(0, 10)}`;
    return h_flex()
      .h(32)
      .px(8)
      .gap(6)
      .items_center()
      .flex_shrink_0()
      .border_b_1()
      .border_color(p.border)
      .bg(p.chrome)
      .when(this.nav.back.length > 0, (el) => el.child(textButton("viewer-back", "← Back", p, (cx) => this.back(cx))))
      .child(div().flex_shrink_0().font_medium().child(viewerTitle(r)))
      .child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(where))
      .children(fileButtons);
  }

  render(p: Palette): Element {
    this.notice();
    const r = this.nav.current;
    if (!r) return div().p(16).text_color(p.dim).child("Nothing to show yet: open a file from the githerd panel.");
    const s = this.shown;
    const body =
      s === null
        ? div().p(12).text_color(p.dim).child("Reading…")
        : s.kind === "note"
          ? div().p(12).text_color(p.changed).child(s.text)
          : s.kind === "diff"
            ? diffBody(s.diff, p)
            : inspectPane(s.view, p, { jump: () => {}, close: () => run("tab.close"), openTreeFile: () => {}, closeTreeFile: () => {} });
    return v_flex().flex_1().min_h_0().child(this.bar(r, p)).child(body);
  }
}
