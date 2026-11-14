// The changed files, for watching what an agent is changing: a filter and a
// List/Tree switch on top, then foldable Staged / Changes / Ignored sections.
// A row's buttons cover its right edge only while the pointer is on it, so the
// list itself stays plain: an icon for the file's kind in its status color, the
// name, the lines it adds and removes, and the status letter again at the end.

import { div, type Context, type Element } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import { excludeLabel } from "../core/exclude.ts";
import { fileKind, patternKind } from "../core/fileKind.ts";
import { allOpen, folderTree, foldKey, isOpen, listEntries, matching, setAll, type FolderNode } from "../core/fileGroups.ts";
import type { LineCounts } from "../core/git/show.ts";
import { nameAndFolder } from "../core/paths.ts";
import type { ChangeFile } from "../core/staging.ts";
import { FILE_ICONS, ICONS, icon, iconButton, textButton, type Palette } from "./style.ts";
import type { ChangesActions, ChangesParts } from "./changes.ts";

const MAX_FILES = 500;

/** How far a row under depth folder rows is indented. */
const indent = (depth: number): number => 10 + depth * 14;

function letterColor(letter: string, p: Palette) {
  if (letter === "D") return p.removed;
  if (letter === "A" || letter === "?") return p.added;
  if (letter === "R" || letter === "C") return p.info;
  return p.changed;
}

/**
 * The row's buttons, a box over its right edge (its counts and status letter): shown on the
 * row under the pointer, or while one asks to confirm. The box is a step lighter than the
 * row's hover color so it reads as a box; the panel's own color goes under it, as theme
 * colors can be see-through, so nothing below shows through.
 */
function overlay(buttons: Element[], p: Palette): Element {
  return div()
    .absolute()
    .right_0()
    .top_0()
    .h_full()
    .bg(p.surface)
    .child(h_flex().h_full().px(6).gap(2).items_center().bg(p.selected).children(buttons));
}

/**
 * A plain row: indented, highlighted under the pointer, its buttons on top while it is.
 * The buttons come after the row's content: a later child is drawn over an earlier one.
 */
function row(id: string, depth: number, show: boolean, buttons: Element[], content: Element[], p: Palette, parts: ChangesParts, a: ChangesActions): Element {
  const shown = (show || parts.hovered === id) && buttons.length > 0;
  return h_flex()
    .id(id)
    .relative()
    .on_hover((on, cx) => a.hover(id, on, cx))
    .h(24)
    .pl(indent(depth))
    .pr(10)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .children(content)
    .when(shown, (el) => el.child(overlay(buttons, p)));
}

/** The file's kind as its icon, drawn in its status color (the Review tab draws its rows the same way). */
export function kindIcon(f: { path: string; letter: string }, p: Palette): Element {
  return icon(FILE_ICONS[fileKind(f.path)], letterColor(f.letter, p), 16);
}

/** The status again as a letter at the row's end, so it reads without telling colors apart. */
export function statusLetter(letter: string, p: Palette): Element {
  return div()
    .min_w(12)
    .flex_shrink_0()
    .text_xs()
    .font_semibold()
    .text_color(letterColor(letter, p))
    .child(letter === "?" ? "U" : letter);
}

export function lineCounts(c: LineCounts | undefined, p: Palette): Element {
  const box = h_flex().flex_shrink_0().gap(4).text_xs();
  if (!c || c.binary) return box;
  return box
    .when(c.added > 0, (el) => el.child(div().text_color(p.added).child(`+${c.added}`)))
    .when(c.deleted > 0, (el) => el.child(div().text_color(p.removed).child(`−${c.deleted}`)));
}

/** A file row; at the top level it also names its folder. */
function fileRow(id: string, f: ChangeFile, depth: number, staged: boolean, buttons: Element[], show: boolean, p: Palette, parts: ChangesParts, a: ChangesActions): Element {
  const { name, folder } = nameAndFolder(f.path);
  const counts = (staged ? parts.counts.staged : parts.counts.unstaged)[f.path];
  return row(id, depth, show, buttons, [
    kindIcon(f, p),
    h_flex()
      .flex_1()
      .min_w_0()
      .gap(6)
      .items_center()
      .when(parts.fresh.has(f.path), (el) => el.child(div().flex_shrink_0().text_xs().text_color(p.accent).child("●")))
      .child(
        div()
          .flex_shrink(1)
          .min_w_0()
          .truncate()
          .when(f.letter === "D", (el) => el.line_through().text_color(p.muted))
          .child(name),
      )
      .when(depth === 0 && folder !== "", (el) => el.child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(folder.replace(/\/$/, "")))),
    lineCounts(counts, p),
    statusLetter(f.letter, p),
  ], p, parts, a).on_click((_e, cx) => a.open(f, staged, cx));
}

/** The buttons a section puts on a file or a folder, and whether they all show (asking to confirm). */
interface RowKit {
  file: (f: ChangeFile, i: number) => { buttons: Element[]; show: boolean };
  folder: (g: FolderNode<ChangeFile>) => { buttons: Element[]; show: boolean };
}

interface Section {
  key: string;
  staged: boolean;
  files: readonly ChangeFile[];
  kit: RowKit;
  /** Every folder shows open: a filter is on. */
  allShown: boolean;
  /** Each file's place in the section, for its row's id. */
  index: ReadonlyMap<string, number>;
}

function folderRows(s: Section, g: FolderNode<ChangeFile>, label: string, depth: number, p: Palette, parts: ChangesParts, a: ChangesActions): Element[] {
  const key = foldKey(s.key, g.folder);
  const open = s.allShown || isOpen(g.folder, parts.flipped, s.key, parts.newFolders);
  const { buttons, show } = s.kit.folder(g);
  const fresh = !open && g.all.some((f) => parts.fresh.has(f.path));
  const head = row(`fd:${key}`, depth, show, buttons, [
    // The folder's icon shows open or folded; a wholly new folder is in the new color.
    icon(open ? ICONS.folderOpen : ICONS.folder, parts.newFolders.includes(g.folder) ? p.added : p.dim, 16),
    h_flex()
      .flex_1()
      .min_w_0()
      .gap(6)
      .items_center()
      .when(fresh, (el) => el.child(div().flex_shrink_0().text_xs().text_color(p.accent).child("●")))
      .child(div().flex_shrink(1).min_w_0().truncate().text_color(p.muted).child(label))
      .when(parts.newFolders.includes(g.folder), (el) =>
        el.child(div().flex_shrink_0().px(4).rounded(3).border_1().border_color(p.added).text_xs().text_color(p.added).child("new")),
      ),
    div().flex_shrink_0().text_xs().text_color(p.dim).child(String(g.all.length)),
  ], p, parts, a).on_click((_e, cx) => a.toggleFolder(key, cx));
  return open ? [head, ...treeBody(s, g, depth + 1, p, parts, a)] : [head];
}

/** In each folder its folders first, then its files. */
function treeBody(s: Section, node: FolderNode<ChangeFile>, depth: number, p: Palette, parts: ChangesParts, a: ChangesActions): Element[] {
  return [
    ...node.folders.flatMap((g) => folderRows(s, g, g.label, depth, p, parts, a)),
    ...node.files.map((f) => fileRowIn(s, f, depth, p, parts, a)),
  ];
}

function fileRowIn(s: Section, f: ChangeFile, depth: number, p: Palette, parts: ChangesParts, a: ChangesActions): Element {
  const i = s.index.get(f.path) ?? 0;
  const { buttons, show } = s.kit.file(f, i);
  return fileRow(`${s.key}f:${i}`, f, depth, s.staged, buttons, show, p, parts, a);
}

function sectionBody(s: Section, p: Palette, parts: ChangesParts, a: ChangesActions): Element[] {
  if (!parts.list) return treeBody(s, folderTree(s.files, parts.newFolders), 0, p, parts, a);
  return listEntries(s.files, parts.newFolders).flatMap((e) =>
    "folder" in e ? folderRows(s, e.folder, e.folder.label, 0, p, parts, a) : [fileRowIn(s, e.file, 0, p, parts, a)],
  );
}

/** A foldable section heading; its buttons show on hover, like a row's. */
function sectionHead(id: string, title: string, count: number, buttons: Element[], p: Palette, parts: ChangesParts, a: ChangesActions): Element {
  const hid = `sec:${id}`;
  const closed = parts.closed.has(id);
  const shown = parts.hovered === hid && count > 0 && buttons.length > 0;
  return h_flex()
    .id(hid)
    .relative()
    .on_hover((on, cx) => a.hover(hid, on, cx))
    .mx(6)
    .mt(8)
    .mb(2)
    .pl(4)
    .pr(2)
    .h(24)
    .rounded(5)
    .items_center()
    .cursor_pointer()
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => a.toggleSection(id, cx))
    .child(div().w(14).flex_shrink_0().text_xs().text_color(p.dim).child(closed ? "▸" : "▾"))
    .child(div().flex_1().text_xs().font_semibold().text_color(count === 0 ? p.dim : p.muted).child(`${title.toUpperCase()}  ${count}`))
    .when(shown, (el) => el.child(overlay(buttons, p)));
}

/** "Expand all" while any folder in the section is folded, then "Collapse all". */
function foldAll(s: Section, p: Palette, parts: ChangesParts, a: ChangesActions): Element[] {
  if (parts.list || s.allShown || folderTree(s.files, parts.newFolders).folders.length === 0) return [];
  const open = allOpen(parts.flipped, s.key, s.files, parts.newFolders);
  return [textButton(`fold-${s.key}`, open ? "Collapse all" : "Expand all", p, (cx) => a.setFlipped(setAll(parts.flipped, s.key, s.files, parts.newFolders, !open), cx))];
}

function stagedKit(p: Palette, a: ChangesActions): RowKit {
  return {
    file: (f, i) => ({
      buttons: [
        iconButton(`sl:${i}`, ICONS.lines, "Unstage lines…", p, (cx) => a.lines(f, true, cx)),
        iconButton(`un:${i}`, ICONS.unstage, "Unstage", p, (cx) => a.unstage([f.path], cx)),
      ],
      show: false,
    }),
    folder: (g) => ({ buttons: [iconButton(`fu:${g.folder}`, ICONS.unstage, "Unstage folder", p, (cx) => a.unstage(g.all.map((f) => f.path), cx))], show: false }),
  };
}

function unstagedKit(p: Palette, parts: ChangesParts, a: ChangesActions): RowKit {
  const confirm = parts.view.confirm;
  return {
    file: (f, i) => {
      const asking = confirm === `discard:${f.path}`;
      // Throwing away is the last step of two: the first click only asks.
      const discard = asking
        ? textButton(`dc:${i}`, f.untracked ? "Delete?" : "Discard?", p, (cx) => a.discard(f, cx), true)
        : iconButton(`dc:${i}`, f.untracked ? ICONS.delete : ICONS.discard, f.untracked ? "Delete file" : "Discard changes", p, (cx) => a.discard(f, cx));
      // A new file has no lines to pick from yet: stage it whole, or ignore it.
      const second = f.untracked
        ? parts.local ? [iconButton(`ig:${i}`, ICONS.ignore, "Ignore locally (.git/info/exclude)", p, (cx) => a.ignore(f, cx))] : []
        : [iconButton(`ul:${i}`, ICONS.lines, "Stage lines…", p, (cx) => a.lines(f, false, cx))];
      return { buttons: [...second, discard, iconButton(`st:${i}`, ICONS.stage, "Stage", p, (cx) => a.stage([f.path], cx))], show: asking };
    },
    folder: (g) => {
      const asking = confirm === `discard-folder:${g.folder}`;
      const untracked = g.all.every((f) => f.untracked);
      const discard = asking
        ? textButton(`fd-dc:${g.folder}`, untracked ? "Delete folder?" : "Discard all?", p, (cx) => a.discardFolder(g.folder, g.isNew, g.all, cx), true)
        : iconButton(`fd-dc:${g.folder}`, untracked ? ICONS.delete : ICONS.discard, untracked ? "Delete folder" : "Discard folder changes", p, (cx) => a.discardFolder(g.folder, g.isNew, g.all, cx));
      // Only a wholly new folder: ignoring one with tracked files would hide its next new files too.
      const ignore = g.isNew && parts.local ? [iconButton(`fd-ig:${g.folder}`, ICONS.ignore, "Ignore folder locally (.git/info/exclude)", p, (cx) => a.ignoreFolder(g.folder, cx))] : [];
      return { buttons: [...ignore, discard, iconButton(`fs:${g.folder}`, ICONS.stage, "Stage folder", p, (cx) => a.stage(g.all.map((f) => f.path), cx))], show: asking };
    },
  };
}

/** The filter and the List / Tree switch. */
export function filesBar(parts: ChangesParts, p: Palette, a: ChangesActions): Element {
  const seg = (label: string, list: boolean) => textButton(`view-${label}`, label, p, (cx) => a.setView(list, cx), parts.list === list);
  return h_flex()
    .flex_shrink_0()
    .px(8)
    .py(6)
    .gap(6)
    .items_center()
    .border_b_1()
    .border_color(p.border)
    .child(div().flex_1().min_w_0().h(24).px(6).rounded(4).border_1().border_color(p.border).bg(p.chrome).child(Input.new(parts.filter).size_full().text_xs().text_color(p.foreground)))
    .child(h_flex().flex_shrink_0().gap(2).child(seg("List", true)).child(seg("Tree", false)));
}

function conflictRows(parts: ChangesParts, p: Palette, a: ChangesActions): Element[] {
  // A conflict blocks everything, so its choices always show.
  return parts.changes.conflicts.map((f, i) =>
    h_flex()
      .id(`cf:${i}`)
      .h(24)
      .pl(10)
      .pr(4)
      .gap(6)
      .items_center()
      .cursor_pointer()
      .hover((el) => el.bg(p.hover))
      .on_click((_e, cx: Context) => a.open(f, false, cx))
      .child(kindIcon(f, p))
      .child(div().flex_1().min_w_0().truncate().child(f.path))
      .child(statusLetter(f.letter, p))
      .children([
        ...(parts.local ? [textButton(`cr:${i}`, "Resolve…", p, (cx) => a.resolve(f, cx))] : []),
        textButton(`co:${i}`, "Take ours", p, (cx) => a.takeSide(f, "ours", cx)),
        textButton(`ct:${i}`, "Take theirs", p, (cx) => a.takeSide(f, "theirs", cx)),
        textButton(`cs:${i}`, "Mark resolved", p, (cx) => a.stage([f.path], cx)),
      ]),
  );
}

/** A folder or file icon in the dim color: ignored entries sit below the changed ones. */
function ignoredIcon(line: string, p: Palette): Element {
  const kind = patternKind(line);
  return icon(kind === "folder" ? ICONS.folder : FILE_ICONS[kind], p.dim, 16);
}

function ignoredRows(parts: ChangesParts, p: Palette, a: ChangesActions): Element[] {
  return parts.ignored.map((line, i) =>
    row(`ig-row:${i}`, 0, false, [iconButton(`ui:${i}`, ICONS.unignore, "Unignore", p, (cx) => a.unignore(line, cx))], [
      ignoredIcon(line, p),
      div().flex_shrink(1).min_w_0().truncate().text_color(p.dim).child(excludeLabel(line)),
      div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(".git/info/exclude"),
    ], p, parts, a).cursor_default(),
  );
}

export function fileLists(parts: ChangesParts, p: Palette, a: ChangesActions): Element[] {
  const { changes } = parts;
  const query = parts.filter.value();
  const allShown = query.trim() !== "";
  const section = (key: string, isStaged: boolean, all: readonly ChangeFile[], kit: RowKit): Section => {
    const files = matching(all, query).slice(0, MAX_FILES);
    return { key, staged: isStaged, files, kit, allShown, index: new Map(files.map((f, i) => [f.path, i])) };
  };
  const staged = section("s", true, changes.staged, stagedKit(p, a));
  const unstaged = section("u", false, changes.unstaged, unstagedKit(p, parts, a));
  const paths = (s: Section) => s.files.map((f) => f.path);
  const body = (id: string, rows: () => Element[]) => (parts.closed.has(id) ? [] : rows());
  const conflicts = conflictRows(parts, p, a);
  const none = div().px(14).py(10).text_xs().text_color(p.dim).child(allShown ? "No files match." : "No changes.");
  return [
    ...(conflicts.length > 0 ? [sectionHead("conflicts", "Conflicts", conflicts.length, [], p, parts, a), ...body("conflicts", () => conflicts)] : []),
    sectionHead("staged", "Staged", staged.files.length, [...foldAll(staged, p, parts, a), iconButton("unstage-all", ICONS.unstage, "Unstage all", p, (cx) => a.unstage(paths(staged), cx))], p, parts, a),
    ...body("staged", () => sectionBody(staged, p, parts, a)),
    sectionHead("changes", "Changes", unstaged.files.length, [...foldAll(unstaged, p, parts, a), iconButton("stage-all", ICONS.stage, "Stage all", p, (cx) => a.stage(paths(unstaged), cx))], p, parts, a),
    ...body("changes", () => (unstaged.files.length === 0 ? [none] : sectionBody(unstaged, p, parts, a))),
    ...(parts.ignored.length > 0 ? [sectionHead("ignored", "Ignored locally", parts.ignored.length, [], p, parts, a), ...body("ignored", () => ignoredRows(parts, p, a))] : []),
  ];
}
