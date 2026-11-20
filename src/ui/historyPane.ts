// The shown repo as a side panel: a row of tabs (changes, review, history, branches,
// more), one list per tab that drills down to a commit, and the sync bar at the
// bottom. Diffs, blame and statistics open in the viewer tab instead; the
// history tab shows the selected commit below its list.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_resizable, resizable_panel, Input, type InputState, type VirtualListScrollHandle } from "gpui-base";
import type { RepoStatus } from "../core/git/status.ts";
import { changesTabLabel } from "../core/headerText.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import type { ForgeChoice } from "../core/forge/index.ts";
import type { InspectView } from "../core/inspect.ts";
import { PANEL_TABS, type PanelTab } from "../core/panel.ts";
import { changesPane, type ChangesActions, type ChangesParts } from "./changes.ts";
import { details, type DetailActions } from "./details.ts";
import { graphList, type GraphActions } from "./graph.ts";
import { inspectPane } from "./inspect.ts";
import { treePane } from "./treePane.ts";
import { commitBar, commitMenu, opsNotices, type OpsActions, type OpsParts } from "./ops.ts";
import { reviewPane, type ReviewActions, type ReviewParts } from "./review.ts";
import { textButton, type Palette } from "./style.ts";

export interface HistoryActions extends GraphActions, DetailActions {
  selectTab: (tab: PanelTab, cx: Context) => void;
  jump: (hash: string, cx: Context) => void;
  reflog: (cx: Context) => void;
  prs: (cx: Context) => void;
  closeInspect: (cx: Context) => void;
  /** Takes the repo as it is now as seen: the new-file dots and counts clear. */
  markSeen: (cx: Context) => void;
  /** Opens a File Tree file in the viewer tab. */
  treeFile: (index: number, cx: Context) => void;
  /** Opens or folds a folder of the File Tree tab. */
  toggleTreeFolder: (folder: string, cx: Context) => void;
  setForge: (kind: ForgeChoice, cx: Context) => void;
  /** Opens or closes the History tab's ⋯ menu. */
  toggleMenu: (cx: Context) => void;
}

export interface HistoryParts {
  view: HistoryView;
  /** An author's saved picture, as `image()` takes it; null draws their initials. */
  avatar: (email: string) => string | null;
  status: RepoStatus | null;
  /** The repo's own config names filter programs: no work-tree diffs. */
  untrusted: readonly string[] | null;
  search: InputState;
  scroll: VirtualListScrollHandle;
  /** The staging panel; null while the repo awaits trust. */
  changes: { parts: ChangesParts; actions: ChangesActions } | null;
  /** Branch and sync actions; null while the repo awaits trust. */
  ops: { parts: OpsParts; actions: OpsActions } | null;
  /** The reflog, pull requests or a commit's files, in place of the tab's list. */
  inspect: InspectView | null;
  tab: PanelTab;
  /** The History tab's ⋯ menu is open. */
  menuOpen: boolean;
  /** What is new since the person last looked; null before the first look. */
  news: { files: number; commits: number | null } | null;
  /** The branch against main, for the Review tab. */
  review: { parts: ReviewParts; actions: ReviewActions };
}

const TAB_LABELS: Record<PanelTab, string> = { changes: "Changes", review: "Review", history: "History" };

function tabRow(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const label = (tab: PanelTab) => (tab === "changes" ? changesTabLabel(parts.status) : TAB_LABELS[tab]);
  return h_flex()
    .h(32)
    .px(6)
    .gap(2)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .children(PANEL_TABS.map((tab) =>
      textButton(`tab-${tab}`, label(tab), p, (cx) => actions.selectTab(tab, cx), parts.tab === tab),
    ));
}

function trustBanner(filters: readonly string[], p: Palette): Element {
  return div()
    .px(10)
    .py(4)
    .flex_shrink_0()
    .text_xs()
    .text_color(p.changed)
    .bg(p.raised)
    .child(`Work-tree changes not read: this repo's own config names ${filters.join(", ")}. History is safe to show.`);
}

function note(text: string, p: Palette): Element {
  return v_flex().flex_1().p(14).text_color(p.dim).child(text);
}

function searchRow(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const { view } = parts;
  const count = view.searching ? `${view.rows.length} found` : `${view.history?.commits.length ?? 0}${view.history?.limited ? "+" : ""}`;
  return h_flex()
    .h(32)
    .px(8)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(
      div()
        .flex_1()
        .min_w_0()
        .h(22)
        .px(6)
        .rounded(4)
        .border_1()
        .border_color(p.border)
        .bg(p.chrome)
        .child(Input.new(parts.search).size_full().text_xs().text_color(p.foreground)),
    )
    .child(div().flex_shrink_0().text_xs().text_color(p.dim).child(count))
    .child(textButton("history-menu", "⋯", p, actions.toggleMenu, parts.menuOpen));
}

/** The ⋯ menu's items, in a line under the search row. */
function historyMenu(p: Palette, actions: HistoryActions): Element {
  return h_flex()
    .h(28)
    .px(8)
    .gap(4)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .bg(p.raised)
    .child(textButton("history-reflog", "Find lost commits (reflog)", p, actions.reflog));
}

const SPLIT = "gitdeck-history-split";
/** The commit pane's height before the divider is first dragged. */
const DETAIL_PX = 340;

/** The selected commit, or its files when the File Tree tab is open. */
function commitPane(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const tree = parts.inspect?.kind === "tree" ? parts.inspect : null;
  if (tree === null) return details(parts.view, parts.status, p, actions, parts.avatar) ?? div();
  return treePane(tree, p, {
    commit: actions.closeInspect,
    close: (cx) => {
      actions.closeInspect(cx);
      actions.close(cx);
    },
    toggleFolder: actions.toggleTreeFolder,
    file: actions.treeFile,
  });
}

/** The commit list, and the selected commit below it; a right-click on a row opens its actions. */
function historyTab(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  const { view, ops } = parts;
  const menu = ops ? commitMenu(ops.parts, p, ops.actions) : null;
  const list = v_flex()
    .relative()
    .flex_1()
    .min_w_0()
    .min_h_0()
    .child(searchRow(parts, p, actions))
    .when(parts.menuOpen, (el) => el.child(historyMenu(p, actions)))
    .child(graphList(view, p, parts.scroll, actions, parts.avatar, ops ? ops.actions.openMenu : undefined))
    // After the row's own handler: the press, as this pane sees it, places the menu.
    .when(ops !== null, (el) => el.on_mouse_down("right", (e, cx) => ops?.actions.placeMenu(e, cx)))
    .when(menu !== null, (el) => el.child(menu ?? div()));
  const open = view.selected !== null && view.selected !== UNCOMMITTED;
  // The commit opens below the list, as Fork's does; the divider between them drags, and the window keeps its place.
  const body = v_resizable(SPLIT)
    .flex_1()
    .min_h_0()
    .child(resizable_panel().size_range(120).child(list.size_full()))
    .when(open, (el) =>
      el.child(resizable_panel().size(DETAIL_PX).size_range(120).child(v_flex().size_full().min_w_0().overflow_hidden().child(commitPane(parts, p, actions)))),
    );
  const pending = ops ? commitBar(ops.parts, p, ops.actions) : null;
  return pending === null ? body : v_flex().flex_1().min_h_0().child(pending).child(body);
}

function tabBody(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  // A commit's File Tree opens in the commit pane, under the list.
  if (parts.inspect && !(parts.inspect.kind === "tree" && parts.tab === "history")) {
    return inspectPane(parts.inspect, p, {
      jump: actions.jump,
      close: actions.closeInspect,
      setForge: actions.setForge,
    });
  }
  if (parts.tab === "changes") {
    if (parts.changes) return changesPane(parts.changes.parts, p, parts.changes.actions);
    return note(parts.untrusted ? "Work-tree changes are not read for this repo." : "Reading changes…", p);
  }
  if (parts.tab === "review") return reviewPane(parts.review.parts, p, parts.review.actions);
  return historyTab(parts, p, actions);
}

/** "● 3 files, 2 commits new since you looked  [Seen]" above Changes and History. */
function newsLine(parts: HistoryParts, p: Palette, actions: HistoryActions): Element | null {
  const n = parts.news;
  if (n === null || (parts.tab !== "changes" && parts.tab !== "history")) return null;
  const commits = n.commits ?? 0;
  if (n.files === 0 && commits === 0) return null;
  const files = n.files === 0 ? null : `${n.files} file${n.files === 1 ? "" : "s"}`;
  const made = commits === 0 ? null : `${commits} commit${commits === 1 ? "" : "s"}`;
  return h_flex()
    .h(26)
    .px(10)
    .gap(6)
    .items_center()
    .flex_shrink_0()
    .text_xs()
    .bg(p.raised)
    .border_b_1()
    .border_color(p.border)
    .child(div().text_color(p.accent).child("●"))
    .child(div().flex_1().min_w_0().truncate().text_color(p.muted).child(`${[files, made].filter(Boolean).join(", ")} new since you looked`))
    .child(textButton("mark-seen", "Seen", p, actions.markSeen));
}

export function historyPane(parts: HistoryParts, p: Palette, actions: HistoryActions): Element {
  return v_flex()
    .flex_1()
    .min_h_0()
    .child(tabRow(parts, p, actions))
    .when(parts.untrusted !== null, (el) => el.child(trustBanner(parts.untrusted ?? [], p)))
    .children([newsLine(parts, p, actions)].filter((e): e is Element => e !== null))
    .child(v_flex().flex_1().min_h_0().child(tabBody(parts, p, actions)))
    .when(parts.ops !== null, (el) =>
      el.child(v_flex().flex_shrink_0().children(parts.ops ? opsNotices(parts.ops.parts, p, parts.ops.actions) : [])),
    );
}
