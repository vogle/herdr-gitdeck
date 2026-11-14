// gitdeck: a git client for Herdr. This file wires Herdr's live data to the core
// (src/core, tested without Herdr) and the views (src/ui).

import { View, div, type AsyncContext, type Context, type Element, type FocusHandle } from "gpui-kit";
import { v_flex, InputState, VirtualListScrollHandle } from "gpui-base";
import { agents, exec, focused, home, knownAgents, nextCommand, panes, props, run, shared, spaces, watchFolder, window } from "herdr";
import { openInBrowser } from "./core/openUrl.ts";
import { prBar } from "./ui/prBar.ts";
import { ChangesPanel } from "./changes.ts";
import { loadReflog, type InspectView } from "./core/inspect.ts";
import { loadBlob, loadTree } from "./core/tree.ts";
import { loadBranchPr, loadPrs, type BranchPr } from "./core/forge/index.ts";

type BranchPrState = Awaited<ReturnType<typeof loadBranchPr>>;
import { backStep, isWide, viewerFocused, type PanelTab } from "./core/panel.ts";
import { markViewed, openReviewFile, openViewer, Viewer } from "./viewer.ts";
import { REVIEWED_KEY, seenFor, type ReviewQueue } from "./core/reviewed.ts";
import { reviewOrder, type ReviewGroup } from "./core/reviewOrder.ts";
import { NET_ENV } from "./core/ops.ts";
import { OpsPanel } from "./ops.ts";
import { contextOf, sameContext } from "./core/context.ts";
import { createGit, type Git, type Target } from "./core/git/runner.ts";
import type { RepoStatus } from "./core/git/status.ts";
import { closePicker, emptyHerd, select, selectedRepo, togglePicker, withRepos, withStatus, type HerdState } from "./core/herd.ts";
import { loadCommit, refreshHistory, type DiffSource } from "./core/history.ts";
import { agentsKey, liveGap, QUIET_MS, relevantChange } from "./core/live.ts";
import {
  closeFile, emptyView, forRepo, jumpTo, rebuild, scrolled, selectCommit, setQuery, showMore,
  withCommit, withHistory, UNCOMMITTED, type HistoryView,
} from "./core/historyView.ts";
import { mapLimit } from "./core/pool.ts";
import { loadStatus, scanHerd } from "./core/scan.ts";
import { Signal } from "./core/signal.ts";
import { MAX_REPOS } from "./core/repos/discover.ts";
import { agentChips, herdAgents, repoAgents, type AgentChip } from "./core/repoAgents.ts";
import { conflictWarning } from "./core/headerText.ts";
import { ago } from "./core/time.ts";
import { freshPaths, markSeen, newCommits, touch, type Seen } from "./core/seen.ts";
import { baseBranch, loadCompare, loadReview, type Compare, type Review } from "./core/review.ts";
import { header, type HeaderSync } from "./ui/header.ts";
import { syncChips } from "./core/syncChips.ts";
import { historyPane, type HistoryActions } from "./ui/historyPane.ts";
import { repoList } from "./ui/repoList.ts";
import { palette } from "./ui/style.ts";
import { summary } from "./ui/summary.ts";
import { checkForUpdate, installUpdate } from "./updater.ts";
import { FeedbackPanel } from "./feedbackPanel.ts";
import { sendQueued } from "./feedbackSend.ts";

/** How often to see whether the daily update check is due. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/** How often the followed folder is compared (no git: just Herdr's data). */
const CONTEXT_EVERY_MS = 2_000;
/** How often every repo's status is read again. */
const STATUS_EVERY_MS = 15_000;
/** git status calls at once. */
const CONCURRENCY = 4;
/** Redraw after this many statuses while a big herd loads. */
const NOTIFY_EVERY = 8;

export const DEPTH_KEY = "gitdeck.depth";

function depthSetting(): number {
  const value = Number(shared(DEPTH_KEY));
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : 3;
}

async function treeLoaded(git: Git, target: Target, rev: string) {
  const t = await loadTree(git, target, rev);
  return { items: t.files, error: t.error };
}

/** When each tab last changed state, by tab id: how long an agent has been as it is. */
function tabChanges(): Map<string, number | null> {
  return new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, t.changed_at] as const)));
}

/** The shown repo's agents, for the header. */
function shownAgents(repo: string | null): AgentChip[] {
  return agentChips(repoAgents(repo, agents(), panes(), tabChanges()));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class GitDeck extends View {
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
  /** The shown repo's folder changed on disk (watched): read its status again soon. */
  readonly liveWake = new Signal();
  /** Repos with a watch loop running (at most one each). */
  readonly watching = new Set<string>();
  /** How long the last live read took, and when it ended (ms). */
  lastLiveMs = 0;
  lastLiveAt = 0;
  /** What the history was last read for: the log is read again only when it changes. */
  historyKey: string | null = null;
  historyFor: string | null = null;
  /** The repo picker lists only the repos with agents. */
  agentsOnly = false;
  /** Each repo as the person last looked at it (memory only). */
  readonly seen = new Map<string, Seen>();
  /** The agents working in the shown repo, as last drawn. */
  agentsSeen = "";
  readonly changesPanel = new ChangesPanel({
    git: this.git,
    target: () => (this.trustedStatus() ? this.repoTarget() : null),
    status: () => this.trustedStatus(),
    changed: (cx) => this.reloadShown(cx),
    agents: () => repoAgents(this.herd.selected, agents(), panes()),
    installedAgents: async () => {
      try {
        return (await knownAgents()).filter((a) => a.installed).map((a) => a.key);
      } catch {
        return []; // Unknown: the agents working in the repo still count.
      }
    },
    openViewer,
    showReview: (cx) => this.selectTab("review", cx),
  });
  readonly opsPanel = new OpsPanel({
    git: this.git,
    net: createGit(exec, NET_ENV),
    target: () => (this.trustedStatus() ? this.repoTarget() : null),
    status: () => this.trustedStatus(),
    history: () => (this.view.repo === this.herd.selected ? this.view.history : null),
    selected: () => this.selectedCommit(),
    agents: () => repoAgents(this.herd.selected, agents(), panes()),
    changed: (cx) => this.reloadShown(cx),
  });
  /** Blame, a file's history or the reflog, for one repo. */
  inspect: { repo: string; view: InspectView } | null = null;
  search!: InputState;
  scroll!: VirtualListScrollHandle;
  /** The panel's open tab. */
  tab: PanelTab = "changes";
  /** The shown repo's branch against main (read with its history). */
  compare: { repo: string; data: Compare | null; base: string | null } | null = null;
  /** The Review tab's files, for one repo. */
  review: { repo: string; data: Review | null } | null = null;
  /** Review groups folded shut: the rest (docs, icons, locks) starts folded. */
  reviewFolded: ReadonlySet<ReviewGroup> = new Set(["other"]);
  /** The shown branch's PR or MR (over the network), for the PR bar and the Review tab. */
  pr: { repo: string; branch: string; state: BranchPrState } | null = null;
  /** Wide enough for the list and the commit side by side. */
  wide = false;
  /** Takes the keyboard so Esc goes back one level. */
  focus!: FocusHandle;
  /** The Review tab's feedback batch: open or folded, the chosen agent, the last send. */
  readonly feedback = new FeedbackPanel();
  /** Set in a viewer tab (props {viewer: true}): that copy only shows the viewer. */
  viewer: Viewer | null = null;

  override init(_props: unknown, cx: AsyncContext): void {
    if ((props() as { viewer?: unknown } | null)?.viewer === true) {
      this.viewer = new Viewer(this.git);
      this.viewer.init(cx);
      cx.notify();
      return;
    }
    this.focus = cx.focus_handle();
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
    // Commands from keys.json or `herdr-app do gitdeck.<command>` (shown copies only).
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "picker") this.togglePicker(cx);
        else if (command === "refresh") this.refresh(cx);
        else if (command === "search") this.search.focus();
        else if (command === "update") void installUpdate();
      }
    });
    // A newer release posts one notification a day; its click sends "update" above.
    cx.spawn(async (cx) => {
      for (;;) {
        await checkForUpdate().catch(() => {});
        await cx.sleep(UPDATE_POLL_MS);
      }
    });
    // Live reads of the shown repo: a burst of saves settles first, and a slow
    // repo gets a wider gap, so the watch never runs git back to back.
    cx.spawn(async (cx) => {
      for (;;) {
        await this.liveWake.wait();
        await cx.sleep(QUIET_MS);
        const wait = liveGap(this.lastLiveMs) - (Date.now() - this.lastLiveAt);
        if (wait > 0) await cx.sleep(wait);
        const started = Date.now();
        await this.reloadShown(cx);
        this.lastLiveAt = Date.now();
        this.lastLiveMs = this.lastLiveAt - started;
      }
    });
    cx.timer.every(CONTEXT_EVERY_MS, (cx) => {
      this.notice();
      // Notes the person queued for a working agent go once it stops.
      sendQueued((task) => cx.spawn(task));
      // Herdr's agent list is live; redraw only when the agents here changed,
      // or when the first one's "· 2m" would read differently.
      const first = shownAgents(this.herd.selected)[0];
      const age = first?.since == null ? "" : ago(Math.floor(Date.now() / 1000), Math.floor(first.since / 1000));
      const seen = this.herd.picking
        ? JSON.stringify(herdAgents(this.herd.repos.map((r) => r.path), agents(), panes()))
        : `${agentsKey(repoAgents(this.herd.selected, agents(), panes()))}|${age}`;
      if (seen !== this.agentsSeen) {
        this.agentsSeen = seen;
        cx.notify();
      }
    });
    cx.timer.every(STATUS_EVERY_MS, () => this.wake.fire());
    this.notice();
  }

  /** Compares the focused folder with the one we follow; a change wakes the git task. */
  notice(): void {
    const focus = focused();
    if (viewerFocused(focus, panes())) return;
    const target = contextOf(focus, panes(), spaces());
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
    if (status) this.changesPanel.syncDraft();
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
    if (this.trustedStatus()) await this.changesPanel.readCounts(cx);
    cx.notify();
  }

  /**
   * Watches the shown repo's folder (local repos only; a remote one keeps the
   * timer). The loop ends at the first event after another repo is shown.
   */
  watch(target: Target, cx: AsyncContext): void {
    const root = target.cwd;
    if (target.on !== null || this.watching.has(root)) return;
    this.watching.add(root);
    cx.spawn(async () => {
      try {
        while (this.herd.selected === root) {
          const paths = await watchFolder(root);
          if (this.herd.selected !== root) break;
          const mark = this.seen.get(root);
          if (mark) this.seen.set(root, touch(mark, root, paths));
          if (relevantChange(root, paths)) this.liveWake.fire();
        }
      } catch {
        // The watch was refused (a huge tree on Linux): the status timer still runs.
      } finally {
        this.watching.delete(root);
      }
    });
  }

  async readHistory(cx: AsyncContext): Promise<void> {
    this.view = forRepo(this.view, this.herd.selected);
    this.changesPanel.forRepo(this.herd.selected);
    this.opsPanel.forRepo(this.herd.selected);
    const target = this.repoTarget();
    this.syncRows();
    cx.notify();
    if (!target) return;
    if (this.trustedStatus()) {
      await this.opsPanel.readOperation(cx);
      await this.changesPanel.readIgnored(cx);
      await this.changesPanel.readCounts(cx);
    }
    this.watch(target, cx);
    const status = this.herd.statuses[target.cwd]?.status;
    if (status && !this.seen.has(target.cwd)) this.seen.set(target.cwd, markSeen(target.cwd, status));
    const known = this.historyFor === target.cwd && this.view.history ? this.historyKey : null;
    const read = await refreshHistory(this.git, target, this.view.limit, known, `${status?.oid ?? ""}|${status?.stash ?? 0}`);
    if (this.herd.selected !== target.cwd) return;
    this.historyKey = read.key;
    this.historyFor = target.cwd;
    if (read.history) {
      this.view = withHistory(this.view, target.cwd, read.history);
      const base = baseBranch(read.history.refs, status?.branch ?? null);
      const data = base === null || !status?.oid ? null : await loadCompare(this.git, target, base);
      if (this.herd.selected === target.cwd) this.compare = { repo: target.cwd, data, base };
      if (this.tab === "review") await this.readReview(cx, this.review === null);
      else await this.readPr(cx, false);
    }
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
    this.focus.focus();
    // The work tree's changes have their own tab, with staging.
    if (hash === UNCOMMITTED) return this.selectTab("changes", cx);
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

  /** A file's diff needs the width: it opens in the viewer tab. */
  openFile(path: string): void {
    const source = this.diffSource(path);
    const target = this.repoTarget();
    if (source && target) openViewer({ view: "diff", repo: target.cwd, on: target.on, source });
  }

  /** The Review tab's data: the files since main, and (with `pr`) the pull request read again. */
  async readReview(cx: AsyncContext, pr: boolean): Promise<void> {
    const target = this.repoTarget();
    const status = target ? this.herd.statuses[target.cwd]?.status : null;
    const base = target && this.compare?.repo === target.cwd ? this.compare.base : null;
    if (!target || !status?.oid || base === null) return;
    const [data] = await Promise.all([loadReview(this.git, target, base, status.oid), pr ? this.readPr(cx, true) : Promise.resolve()]);
    if (this.herd.selected !== target.cwd) return;
    this.review = { repo: target.cwd, data };
    cx.notify();
  }

  /** The shown branch's PR or MR; read once per repo and branch unless `again`. */
  async readPr(cx: AsyncContext, again: boolean): Promise<void> {
    const target = this.repoTarget();
    const branch = target ? this.herd.statuses[target.cwd]?.status?.branch : null;
    if (!target || !branch) return;
    if (!again && this.pr?.repo === target.cwd && this.pr.branch === branch) return;
    const state = await loadBranchPr(this.git, exec, target, await this.homeFor(target), branch);
    if (this.herd.selected !== target.cwd) return;
    this.pr = { repo: target.cwd, branch, state };
    cx.notify();
  }

  /** The PR state for the shown repo's current branch; null while unread or on another branch. */
  shownPr(path: string): BranchPrState | null {
    const branch = this.herd.statuses[path]?.status?.branch;
    return this.pr?.repo === path && this.pr.branch === branch ? this.pr.state : null;
  }

  /** Opens a link in this machine's default browser; a failure shows in the error line. */
  openLink(url: string, cx: Context): void {
    cx.spawn(async (cx) => {
      const failed = await openInBrowser(exec, window().platform, url);
      if (failed === null) return;
      this.error = failed;
      cx.notify();
    });
  }

  /** The shown repo's review as a queue in reading order, or null while it isn't read. */
  reviewQueue(): ReviewQueue | null {
    const target = this.repoTarget();
    const r = target && this.review?.repo === target.cwd ? this.review.data : null;
    if (!target || !r?.mergeBase) return null;
    const files = reviewOrder(r.files).map((f) => ({ path: f.path, oldPath: f.oldPath, blob: r.blobs.get(f.path) ?? "" }));
    return { repo: target.cwd, on: target.on, head: r.head, mergeBase: r.mergeBase, files };
  }

  /** A file of the Review tab: its diff since the branch split from main, marked viewed. */
  openReviewFile(path: string): void {
    const queue = this.reviewQueue();
    const file = queue?.files.find((f) => f.path === path);
    if (queue && file) openReviewFile(queue, file);
  }

  toggleReviewed(path: string, seenNow: boolean): void {
    const queue = this.reviewQueue();
    const file = queue?.files.find((f) => f.path === path);
    if (queue && file) markViewed(queue.repo, path, file.blob, !seenNow, queue.files.map((f) => f.path));
  }

  selectTab(tab: PanelTab, cx: Context): void {
    if (tab === "review" && this.tab !== "review") cx.spawn((cx) => this.readReview(cx, true));
    this.tab = tab;
    this.inspect = null;
    this.focus.focus();
    cx.notify();
  }

  /** Esc or ← Back: closes the innermost level open. */
  back(cx: Context): void {
    const step = backStep({ inspect: this.inspect !== null, file: this.view.file, selected: this.view.selected });
    if (step === "inspect") this.inspect = null;
    else if (step === "file") this.view = closeFile(this.view);
    else if (step === "commit" && this.view.selected) this.view = selectCommit(this.view, this.view.selected);
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
      // Blame, a file's history and the statistics open in the viewer tab instead.
      const done: InspectView =
        v.kind === "reflog"
          ? { ...v, data: await loadReflog(this.git, target) }
          : v.kind === "prs"
            ? { ...v, data: await loadPrs(this.git, exec, target, await this.homeFor(target)) }
            : v.kind === "tree"
              ? { ...v, data: await treeLoaded(this.git, target, v.rev) }
              : v;
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

  jump(hash: string, cx: Context): void {
    this.tab = "history";
    this.inspect = null;
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
      openFile: (path) => this.openFile(path),
      close: (cx) => this.back(cx),
      selectTab: (tab, cx) => this.selectTab(tab, cx),
      jump: (hash, cx) => this.jump(hash, cx),
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
      stats: () => {
        const target = this.repoTarget();
        if (target) openViewer({ view: "stats", repo: target.cwd, on: target.on });
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
      markSeen: (cx) => {
        const path = this.herd.selected;
        const status = path ? this.herd.statuses[path]?.status : null;
        if (!path || !status) return;
        this.seen.set(path, markSeen(path, status));
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
    this.historyKey = null;
    this.herd = closePicker(this.herd);
    this.wake.fire();
    cx.notify();
  }

  /** The header's refresh: scans again and, for a shown repo it can trust, fetches its remotes too. */
  refreshAndFetch(cx: Context): void {
    this.refresh(cx);
    if (this.trustedStatus() && !this.herd.picking) this.opsPanel.actions().fetch(cx);
    // A PR the agent opened since the branch was read shows up on refresh.
    cx.spawn((cx) => this.readPr(cx, true));
  }

  /** Pull and push in the header, for the shown repo when its status is trusted. */
  headerSync(): HeaderSync | null {
    const status = this.herd.picking ? null : this.trustedStatus();
    if (status === null) return null;
    const ops = this.opsPanel.actions();
    return {
      chips: syncChips(status),
      busy: this.opsPanel.view.busy !== null,
      run: (kind, cx) => (kind === "pull" ? ops.pull(cx) : ops.push(cx)),
    };
  }

  /** What changed since the person last looked at the repo (pure: a few set lookups). */
  news(path: string | null, status: RepoStatus | null): { paths: Set<string>; commits: number | null } | null {
    const mark = path ? this.seen.get(path) : undefined;
    if (!mark || !status) return null;
    const log = this.view.repo === path ? (this.view.history?.commits ?? []) : [];
    return { paths: freshPaths(mark, status), commits: newCommits(mark, status.oid, log) };
  }

  override render(_cx: Context): Element {
    const p = palette();
    if (this.viewer) {
      return v_flex().id("gitdeck-viewer").size_full().bg(p.surface).text_size(13).text_color(p.foreground).child(this.viewer.render(p));
    }
    this.notice();
    const repo = selectedRepo(this.herd);
    const result = repo ? this.herd.statuses[repo.path] : undefined;
    const news = this.news(repo?.path ?? null, result?.status ?? null);
    const shown = repo && !this.herd.picking ? this.shownPr(repo.path) : null;
    const body = this.herd.picking
      ? repoList(this.herd, p, (path, cx) => this.pick(path, cx), {
          byRepo: herdAgents(this.herd.repos.map((r) => r.path), agents(), panes()),
          only: this.agentsOnly,
          toggle: (cx) => {
            this.agentsOnly = !this.agentsOnly;
            cx.notify();
          },
        })
      : repo && this.view.repo === repo.path
        ? historyPane(
            {
              view: this.view,
              status: result?.status ?? null,
              untrusted: result?.untrusted ?? null,
              search: this.search,
              scroll: this.scroll,
              changes: this.trustedStatus() ? { parts: { ...this.changesPanel.parts(), fresh: news?.paths ?? new Set() }, actions: this.changesPanel.actions() } : null,
              news: news ? { files: news.paths.size, commits: news.commits } : null,
              inspect: this.inspect?.repo === repo.path ? this.inspect.view : null,
              ops: this.trustedStatus() ? { parts: this.opsPanel.parts(), actions: this.opsPanel.actions() } : null,
              tab: this.tab,
              wide: this.wide,
              review: {
                parts: {
                  base: this.compare?.repo === repo.path ? this.compare.base : null,
                  review: this.review?.repo === repo.path ? this.review.data : null,
                  pr: this.shownPr(repo.path),
                  seen: seenFor(shared(REVIEWED_KEY), repo.path),
                  folded: this.reviewFolded,
                  feedback: this.feedback.render(
                    repo.path,
                    this.repoTarget()?.on != null,
                    (this.review?.repo === repo.path ? this.review.data?.blobs : null) ?? new Map(),
                    p,
                  ),
                },
                actions: {
                  openFile: (path) => this.openReviewFile(path),
                  toggleViewed: (path, cx) => {
                    const r = this.review?.repo === repo.path ? this.review.data : null;
                    const seen = seenFor(shared(REVIEWED_KEY), repo.path);
                    this.toggleReviewed(path, r !== null && seen[path] !== undefined && seen[path] === r.blobs.get(path));
                    cx.notify();
                  },
                  toggleGroup: (group, cx) => {
                    const next = new Set(this.reviewFolded);
                    if (!next.delete(group)) next.add(group);
                    this.reviewFolded = next;
                    cx.notify();
                  },
                  refresh: (cx) => {
                    cx.spawn((cx) => this.readReview(cx, true));
                  },
                },
              },
            },
            p,
            this.historyActions(),
          )
        : summary(this.herd, p, this.busy && this.herd.root === null);
    return v_flex()
      .id("gitdeck")
      .size_full()
      .track_focus(this.focus)
      .on_key_down((e, cx) => {
        if (e.keystroke === "escape") this.back(cx);
      })
      .on_size_change((size, cx) => {
        if (isWide(size.width) === this.wide) return;
        this.wide = isWide(size.width);
        cx.notify();
      })
      .bg(p.surface)
      .text_size(13)
      .text_color(p.foreground)
      .child(
        header(
          this.herd,
          this.busy,
          p,
          { togglePicker: (cx) => this.togglePicker(cx), refresh: (cx) => this.refreshAndFetch(cx) },
          {
            agents: shownAgents(this.herd.selected),
            compare: this.compare?.repo === this.herd.selected ? this.compare.data : null,
            sync: this.headerSync(),
            conflicts: conflictWarning((this.herd.selected ? this.herd.statuses[this.herd.selected]?.status : null) ?? null),
            now: Date.now(),
          },
        ),
      )
      .when(shown?.pr != null, (el) =>
        el.child(
          prBar(shown?.pr as BranchPr, shown?.label ?? "PR", p, {
            review: (cx) => this.selectTab("review", cx),
            open: (url, cx) => this.openLink(url, cx),
          }),
        ),
      )
      .when(this.error !== null, (el) =>
        el.child(div().px(12).py(6).text_xs().text_color(p.removed).bg(p.raised).child(this.error ?? "")),
      )
      .child(body);
  }
}
