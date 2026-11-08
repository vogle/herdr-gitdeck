// githerd: a git client for Herdr. This file wires Herdr's live data to the core
// (src/core, tested without Herdr) and the views (src/ui).

import { View, div, type AsyncContext, type Context, type Element } from "gpui-kit";
import { v_flex, InputState, VirtualListScrollHandle } from "gpui-base";
import { exec, focused, home, nextCommand, panes, shared, spaces } from "herdr";
import { ChangesPanel } from "./changes.ts";
import { loadBlame, loadFileLog, loadReflog, type InspectView } from "./core/inspect.ts";
import { loadBlob, loadTree } from "./core/tree.ts";
import { loadStats } from "./core/stats.ts";
import { loadPrs } from "./core/github.ts";
import { NET_ENV } from "./core/ops.ts";
import { OpsPanel } from "./ops.ts";
import { contextOf, sameContext } from "./core/context.ts";
import { createGit, type Git, type Target } from "./core/git/runner.ts";
import type { RepoStatus } from "./core/git/status.ts";
import { closePicker, emptyHerd, select, selectedRepo, togglePicker, withRepos, withStatus, type HerdState } from "./core/herd.ts";
import { loadCommit, loadDiff, loadHistory, type DiffSource } from "./core/history.ts";
import {
  closeFile, emptyView, forRepo, jumpTo, openFile, rebuild, scrolled, selectCommit, setQuery, showMore,
  toggleSidebar, withCommit, withDiff, withHistory, UNCOMMITTED, type HistoryView,
} from "./core/historyView.ts";
import { mapLimit } from "./core/pool.ts";
import { loadStatus, scanHerd } from "./core/scan.ts";
import { Signal } from "./core/signal.ts";
import { MAX_REPOS } from "./core/repos/discover.ts";
import { header } from "./ui/header.ts";
import { historyPane, type HistoryActions } from "./ui/historyPane.ts";
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

async function treeLoaded(git: Git, target: Target, rev: string) {
  const t = await loadTree(git, target, rev);
  return { items: t.files, error: t.error };
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
  view: HistoryView = emptyView();
  /** Wakes the task that reads the shown repo's history. */
  readonly historyWake = new Signal();
  readonly changesPanel = new ChangesPanel({
    git: this.git,
    target: () => (this.trustedStatus() ? this.repoTarget() : null),
    status: () => this.trustedStatus(),
    changed: (cx) => this.reloadShown(cx),
  });
  readonly opsPanel = new OpsPanel({
    git: this.git,
    net: createGit(exec, NET_ENV),
    target: () => (this.trustedStatus() ? this.repoTarget() : null),
    status: () => this.trustedStatus(),
    history: () => (this.view.repo === this.herd.selected ? this.view.history : null),
    selected: () => this.selectedCommit(),
    changed: (cx) => this.reloadShown(cx),
  });
  /** Blame, a file's history or the reflog, for one repo. */
  inspect: { repo: string; view: InspectView } | null = null;
  search!: InputState;
  scroll!: VirtualListScrollHandle;

  override init(_props: unknown, cx: AsyncContext): void {
    this.search = InputState.new({ placeholder: "Search subject, author, branch, hash" });
    this.search.on("change", (_e, cx) => {
      this.view = setQuery(this.view, this.search.value());
      cx.notify();
    });
    this.scroll = VirtualListScrollHandle.new();
    this.changesPanel.init();
    this.opsPanel.init();
    cx.spawn(async (cx) => {
      for (;;) {
        await this.historyWake.wait();
        await this.readHistory(cx);
      }
    });
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
        else if (command === "search") this.search.focus();
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
      // The shown repo's status is fresh: read its history again too.
      if (path === first) this.historyWake.fire();
      done += 1;
      if (path === first || done % NOTIFY_EVERY === 0) cx.notify();
    });
  }

  pick(path: string, cx: Context): void {
    this.herd = select(this.herd, path);
    this.historyWake.fire();
    cx.notify();
  }

  /** Where the shown repo's git runs. */
  repoTarget(): Target | null {
    const repo = this.herd.selected;
    return repo ? { cwd: repo, on: this.shown?.on ?? null } : null;
  }

  /** The uncommitted row follows the shown repo's status (never for a repo awaiting trust). */
  syncRows(): void {
    const status = this.trustedStatus();
    const changes = status ? status.entries.filter((e) => e.kind !== "ignored").length : 0;
    this.view = rebuild(this.view, status?.oid ?? null, changes);
  }

  /** The shown repo's status, unless it is waiting for trust. */
  trustedStatus(): RepoStatus | null {
    const result = this.herd.selected ? this.herd.statuses[this.herd.selected] : undefined;
    return result?.untrusted ? null : (result?.status ?? null);
  }

  /** After a change made here: the shown repo's status, then its history. */
  async reloadShown(cx: AsyncContext): Promise<void> {
    const target = this.repoTarget();
    if (!target) return;
    const result = await loadStatus(this.git, target);
    if (this.herd.selected !== target.cwd) return;
    this.herd = withStatus(this.herd, target.cwd, result);
    this.syncRows();
    this.historyWake.fire();
    cx.notify();
  }

  async readHistory(cx: AsyncContext): Promise<void> {
    this.view = forRepo(this.view, this.herd.selected);
    this.changesPanel.forRepo(this.herd.selected);
    this.opsPanel.forRepo(this.herd.selected);
    const target = this.repoTarget();
    this.syncRows();
    cx.notify();
    if (!target) return;
    if (this.trustedStatus()) await this.opsPanel.readOperation(cx);
    const history = await loadHistory(this.git, target, this.view.limit);
    this.view = withHistory(this.view, target.cwd, history);
    this.syncRows();
    cx.notify();
  }

  /** The selected commit with its parent count; none for the uncommitted row. */
  selectedCommit(): { hash: string; parents: number } | null {
    const hash = this.view.selected;
    if (!hash || hash === UNCOMMITTED) return null;
    const commit = this.view.rows.find((r) => r.hash === hash) ?? this.view.history?.commits.find((r) => r.hash === hash);
    return commit ? { hash, parents: commit.parents.length } : null;
  }

  pickCommit(hash: string, cx: Context): void {
    this.view = selectCommit(this.view, hash);
    this.opsPanel.reselected();
    this.readCommit(cx);
    cx.notify();
  }

  readCommit(cx: Context): void {
    const hash = this.view.selected;
    const target = this.repoTarget();
    const commit = this.view.rows.find((r) => r.hash === hash) ?? this.view.history?.commits.find((r) => r.hash === hash);
    if (!hash || hash === UNCOMMITTED || !target || !commit) return;
    cx.spawn(async (cx) => {
      this.view = withCommit(this.view, hash, await loadCommit(this.git, target, hash, commit.parents));
      cx.notify();
    });
  }

  diffSource(path: string): DiffSource | null {
    const hash = this.view.selected;
    if (hash === UNCOMMITTED) {
      const result = this.herd.selected ? this.herd.statuses[this.herd.selected] : undefined;
      // A work-tree diff runs the repo's clean filters: never without its trust.
      if (!result?.status || result.untrusted) return null;
      const entry = result.status.entries.find((e) => e.path === path);
      if (!entry) return null;
      return entry.kind === "untracked" ? { kind: "untracked", path } : { kind: "worktree", path, hasHead: result.status.oid !== null };
    }
    const commit = this.view.rows.find((r) => r.hash === hash) ?? this.view.history?.commits.find((r) => r.hash === hash);
    const file = this.view.commit?.files.find((f) => f.path === path);
    if (!hash || !commit || !file) return null;
    return { kind: "commit", hash, parents: commit.parents, path, oldPath: file.oldPath };
  }

  openFile(path: string, cx: Context): void {
    const source = this.diffSource(path);
    const target = this.repoTarget();
    if (!source || !target) return;
    this.view = openFile(this.view, path);
    cx.spawn(async (cx) => {
      this.view = withDiff(this.view, path, await loadDiff(this.git, target, source));
      cx.notify();
    });
    cx.notify();
  }

  /** Opens the inspect pane and reads what it shows. */
  openInspect(view: InspectView, cx: Context): void {
    const target = this.repoTarget();
    if (!target) return;
    this.inspect = { repo: target.cwd, view };
    cx.notify();
    cx.spawn(async (cx) => {
      const v = view;
      const done: InspectView =
        v.kind === "blame"
          ? { ...v, data: await loadBlame(this.git, target, v.rev, v.path) }
          : v.kind === "file-log"
            ? { ...v, data: await loadFileLog(this.git, target, v.rev, v.path) }
            : v.kind === "reflog"
              ? { ...v, data: await loadReflog(this.git, target) }
              : v.kind === "stats"
                ? { ...v, data: await loadStats(this.git, target) }
                : v.kind === "prs"
                ? { ...v, data: await loadPrs(this.git, exec, target, await this.homeFor(target)) }
                : { ...v, data: await treeLoaded(this.git, target, v.rev) };
      if (this.inspect?.view === view) this.inspect = { repo: target.cwd, view: done };
      cx.notify();
    });
  }

  /** The tree pane: open one file, or go back to the list. */
  treeFile(index: number | null, cx: Context): void {
    const current = this.inspect;
    const target = this.repoTarget();
    if (current?.view.kind !== "tree" || !target) return;
    const tree = current.view;
    const file = index === null ? null : (tree.data?.items[index] ?? null);
    const opened: InspectView = { ...tree, file, blob: null };
    this.inspect = { ...current, view: opened };
    cx.notify();
    if (!file) return;
    cx.spawn(async (cx) => {
      const blob = await loadBlob(this.git, target, tree.rev, file);
      if (this.inspect?.view === opened) this.inspect = { ...current, view: { ...opened, blob } };
      cx.notify();
    });
  }

  inspectFile(kind: "blame" | "file-log", path: string, cx: Context): void {
    const sel = this.selectedCommit();
    if (sel) this.openInspect({ kind, path, rev: sel.hash, data: null }, cx);
  }

  jump(hash: string, cx: Context): void {
    this.view = jumpTo(this.view, hash);
    this.opsPanel.reselected();
    if (this.search.value() !== "") this.search.set_value("");
    if (this.view.scrollTo !== null) {
      this.scroll.scroll_to_item(this.view.scrollTo, "center");
      this.view = scrolled(this.view);
    }
    this.readCommit(cx);
    cx.notify();
  }

  historyActions(): HistoryActions {
    return {
      pick: (hash, cx) => this.pickCommit(hash, cx),
      more: (cx) => {
        this.view = showMore(this.view);
        this.historyWake.fire();
        cx.notify();
      },
      openFile: (path, cx) => this.openFile(path, cx),
      closeFile: (cx) => {
        this.view = closeFile(this.view);
        cx.notify();
      },
      close: (cx) => {
        if (this.view.selected) this.view = selectCommit(this.view, this.view.selected);
        cx.notify();
      },
      toggleSidebar: (cx) => {
        this.view = toggleSidebar(this.view);
        cx.notify();
      },
      jump: (hash, cx) => this.jump(hash, cx),
      inspectFile: (kind, path, cx) => this.inspectFile(kind, path, cx),
      reflog: (cx) => {
        if (this.inspect?.view.kind === "reflog") {
          this.inspect = null;
          return cx.notify();
        }
        this.openInspect({ kind: "reflog", data: null }, cx);
      },
      prs: (cx) => {
        if (this.inspect?.view.kind === "prs") {
          this.inspect = null;
          return cx.notify();
        }
        this.openInspect({ kind: "prs", data: null }, cx);
      },
      stats: (cx) => {
        if (this.inspect?.view.kind === "stats") {
          this.inspect = null;
          return cx.notify();
        }
        this.openInspect({ kind: "stats", data: null }, cx);
      },
      treeFile: (index, cx) => this.treeFile(index, cx),
      browseTree: (cx) => {
        const sel = this.selectedCommit();
        if (sel) this.openInspect({ kind: "tree", rev: sel.hash, data: null, file: null, blob: null }, cx);
      },
      closeInspect: (cx) => {
        this.inspect = null;
        cx.notify();
      },
    };
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
    const repo = selectedRepo(this.herd);
    const result = repo ? this.herd.statuses[repo.path] : undefined;
    const body = this.herd.picking
      ? repoList(this.herd, p, (path, cx) => this.pick(path, cx))
      : repo && this.view.repo === repo.path
        ? historyPane(
            {
              view: this.view,
              status: result?.status ?? null,
              untrusted: result?.untrusted ?? null,
              search: this.search,
              scroll: this.scroll,
              changes: this.trustedStatus() ? { parts: this.changesPanel.parts(), actions: this.changesPanel.actions() } : null,
              inspect: this.inspect?.repo === repo.path ? this.inspect.view : null,
              ops: this.trustedStatus() ? { parts: this.opsPanel.parts(), actions: this.opsPanel.actions() } : null,
            },
            p,
            this.historyActions(),
          )
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
