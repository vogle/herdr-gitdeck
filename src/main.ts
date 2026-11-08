// githerd: a git client for Herdr. This file wires Herdr's live data to the core
// (src/core, tested without Herdr) and the views (src/ui).

import { View, div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, focused, home, nextCommand, panes, shared, spaces } from "herdr";
import { contextOf, sameContext } from "./core/context.ts";
import { createGit, type Target } from "./core/git/runner.ts";
import { closePicker, emptyHerd, select, togglePicker, withRepos, withStatus, type HerdState } from "./core/herd.ts";
import { mapLimit } from "./core/pool.ts";
import { loadStatus, scanHerd } from "./core/scan.ts";
import { Signal } from "./core/signal.ts";
import { MAX_REPOS } from "./core/repos/discover.ts";
import { header } from "./ui/header.ts";
import { repoList } from "./ui/repoList.ts";
import { palette } from "./ui/style.ts";
import { summary } from "./ui/summary.ts";

/** How often the followed folder is compared (no git: just Herdr's data). */
const CONTEXT_EVERY_MS = 2_000;
/** How often every repo's status is read again. */
const STATUS_EVERY_MS = 15_000;
/** git status calls at once. */
const CONCURRENCY = 4;
/** Redraw after this many statuses while a big herd loads. */
const NOTIFY_EVERY = 8;

export const DEPTH_KEY = "githerd.depth";

function depthSetting(): number {
  const value = Number(shared(DEPTH_KEY));
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : 3;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class Githerd extends View {
  herd: HerdState = emptyHerd();
  /** The folder the herd was scanned for. */
  shown: Target | null = null;
  /** The folder Herdr's focus points at now. */
  wanted: Target | null = null;
  force = false;
  busy = false;
  error: string | null = null;
  readonly wake = new Signal();
  /** Remote machines' home folders, by machine. */
  readonly homes = new Map<string, string>();
  readonly git = createGit(exec);

  override init(_props: unknown, cx: AsyncContext): void {
    // The only task that runs git. render() and the timers just wake it.
    cx.spawn(async (cx) => {
      for (;;) {
        await this.wake.wait();
        await this.sync(cx);
      }
    });
    // Commands from keys.json or `herdr-app do githerd.<command>` (shown copies only).
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "picker") this.togglePicker(cx);
        else if (command === "refresh") this.refresh(cx);
      }
    });
    cx.timer.every(CONTEXT_EVERY_MS, () => this.notice());
    cx.timer.every(STATUS_EVERY_MS, () => this.wake.fire());
    this.notice();
  }

  /** Compares the focused folder with the one we follow; a change wakes the git task. */
  notice(): void {
    const target = contextOf(focused(), panes(), spaces());
    if (!sameContext(target, this.wanted)) {
      this.wanted = target;
      this.wake.fire();
    }
  }

  /**
   * The machine's home, which is never walked as a whole. Asked once per remote
   * machine; when it can't be asked, the followed folder stands in, so a folder
   * that isn't a repo is never walked there.
   */
  async homeFor(target: Target): Promise<string> {
    if (!target.on) return home();
    const known = this.homes.get(target.on);
    if (known) return known;
    const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: target.on }).catch(() => null);
    const found = r && r.code === 0 && r.stdout.startsWith("/") ? r.stdout : null;
    if (found) this.homes.set(target.on, found);
    return found ?? target.cwd;
  }

  async sync(cx: AsyncContext): Promise<void> {
    const target = this.wanted;
    if (!target) return;
    const followFocus = !sameContext(target, this.shown);
    const rescan = this.force || followFocus;
    this.force = false;
    this.busy = true;
    cx.notify();
    try {
      if (rescan) {
        const deps = { git: this.git, exec, home: await this.homeFor(target), depth: depthSetting() };
        const scan = await scanHerd(deps, target);
        // Focus moved meanwhile: the signal is already pending, the next round scans the new folder.
        if (!sameContext(target, this.wanted)) return;
        this.shown = target;
        this.herd = withRepos(this.herd, scan, { followFocus });
        this.error = scan.error ?? (scan.truncated ? `Showing the first ${MAX_REPOS} repositories only` : null);
        cx.notify();
      }
      await this.loadStatuses(cx, target);
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.busy = false;
      cx.notify();
    }
  }

  /** The shown repo first, then the rest of the herd. */
  async loadStatuses(cx: AsyncContext, target: Target): Promise<void> {
    const root = this.herd.root;
    const first = this.herd.selected;
    const paths = [...(first ? [first] : []), ...this.herd.repos.map((r) => r.path).filter((p) => p !== first)];
    let done = 0;
    // Focus moved or a rescan was asked for: stop here, the next round starts over.
    const stale = () => this.force || !sameContext(target, this.wanted) || this.herd.root !== root;
    await mapLimit(paths, CONCURRENCY, async (path) => {
      if (stale()) return;
      const result = await loadStatus(this.git, { cwd: path, on: target.on });
      if (stale()) return;
      this.herd = withStatus(this.herd, path, result);
      done += 1;
      if (path === first || done % NOTIFY_EVERY === 0) cx.notify();
    });
  }

  pick(path: string, cx: Context): void {
    this.herd = select(this.herd, path);
    cx.notify();
  }

  togglePicker(cx: Context): void {
    this.herd = togglePicker(this.herd);
    cx.notify();
  }

  refresh(cx: Context): void {
    this.force = true;
    this.herd = closePicker(this.herd);
    this.wake.fire();
    cx.notify();
  }

  override render(_cx: Context): Element {
    this.notice();
    const p = palette();
    const body = this.herd.picking
      ? repoList(this.herd, p, (path, cx) => this.pick(path, cx))
      : summary(this.herd, p, this.busy && this.herd.root === null);
    return v_flex()
      .id("githerd")
      .size_full()
      .bg(p.surface)
      .text_size(13)
      .text_color(p.foreground)
      .child(
        header(this.herd, this.busy, p, {
          togglePicker: (cx) => this.togglePicker(cx),
          refresh: (cx) => this.refresh(cx),
        }),
      )
      .when(this.error !== null, (el) =>
        el.child(div().px(12).py(6).text_xs().text_color(p.removed).bg(p.raised).child(this.error ?? "")),
      )
      .child(body);
  }
}
