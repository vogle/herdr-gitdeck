// A commit's files as a folder tree, in the commit pane under the History list
// (Fork's File Tree tab). Rows are drawn as the Changes tab draws its files:
// the kind's icon, the name, and here the size at the end. A click on a file
// opens it, as it is at the commit, in the viewer tab.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { fileKind } from "../core/fileKind.ts";
import type { InspectView } from "../core/inspect.ts";
import { sizeText, treeRows, type TreeRow } from "../core/treeRows.ts";
import { tabBar } from "./details.ts";
import { FILE_ICONS, ICONS, icon, textButton, type Palette } from "./style.ts";

const LIST = "gitdeck-tree";
const ROW = 24;

export interface TreeActions {
  /** Back to the commit's own tab. */
  commit: (cx: Context) => void;
  /** Closes the commit pane. */
  close: (cx: Context) => void;
  toggleFolder: (folder: string, cx: Context) => void;
  /** Opens a file (its place in the tree's list) in the viewer tab. */
  file: (index: number, cx: Context) => void;
}

type TreeView = Extract<InspectView, { kind: "tree" }>;

/** How far a row under depth folder rows is indented: the Changes tab's step. */
const indent = (depth: number): number => 10 + depth * 14;

const rowKey = (r: TreeRow): string => (r.kind === "folder" ? `d:${r.folder}` : `f:${r.index}`);

function treeRow(r: TreeRow, p: Palette): Element {
  const base = h_flex().h(ROW).pl(indent(r.depth)).pr(10).gap(6).items_center().whitespace_nowrap().cursor_pointer().hover((el) => el.bg(p.hover));
  if (r.kind === "folder") {
    return base
      .child(icon(r.open ? ICONS.folderOpen : ICONS.folder, p.dim, 16))
      .child(div().flex_1().min_w_0().truncate().text_color(p.muted).child(r.label))
      .child(div().flex_shrink_0().text_xs().text_color(p.dim).child(String(r.count)));
  }
  const f = r.file;
  return base
    .child(icon(FILE_ICONS[fileKind(f.path)], p.muted, 16))
    .child(div().flex_1().min_w_0().truncate().child(r.name))
    .child(div().flex_shrink_0().text_xs().text_color(p.dim).child(f.kind === "file" ? sizeText(f.size) : f.kind));
}

function note(text: string, color: Palette["dim"]): Element {
  return div().p(12).text_xs().text_color(color).child(text);
}

function folders(v: TreeView, p: Palette, a: TreeActions): Element {
  if (v.data === null) return note("Reading files…", p.dim);
  if (v.data.error !== null) return note(v.data.error, p.removed);
  const rows = treeRows(v.data.items, v.open);
  return div()
    .relative()
    .flex_1()
    .min_h_0()
    .child(
      v_virtual_list(LIST, rows.length, ROW, (i) => (rows[i] ? rowKey(rows[i]) : String(i)), (range) => rows.slice(range.start, range.end).map((r) => treeRow(r, p)))
        .on_item_click((key, cx) => (key.startsWith("d:") ? a.toggleFolder(key.slice(2), cx) : a.file(Number(key.slice(2)), cx)))
        .size_full(),
    )
    .child(Scrollbar.vertical(LIST).absolute().inset_0());
}

/** The commit pane's File Tree tab. */
export function treePane(v: TreeView, p: Palette, a: TreeActions): Element {
  return v_flex()
    .flex_1()
    .min_h_0()
    .border_t_1()
    .border_color(p.border)
    .bg(p.surface)
    .child(
      tabBar(
        p,
        textButton("details-commit", "Commit", p, a.commit),
        textButton("details-tree", "File Tree", p, () => {}, true),
        div().flex_1(),
        textButton("details-close", "Close", p, a.close),
      ),
    )
    .child(folders(v, p, a));
}
