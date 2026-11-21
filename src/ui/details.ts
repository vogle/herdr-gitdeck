// Below the graph: the selected commit (or the work tree's changes), its files,
// and one file's diff.

import { div, image, type Context, type Element } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, type VirtualListScrollHandle } from "gpui-base";
import type { Diff, DiffRow } from "../core/git/diff.ts";
import type { ImagePair } from "../core/imageDiff.ts";
import type { CommitFile } from "../core/git/show.ts";
import type { RepoStatus, StatusEntry } from "../core/git/status.ts";
import { UNCOMMITTED, type HistoryView } from "../core/historyView.ts";
import { authorBadge } from "../core/graph/rowText.ts";
import { dateTime } from "../core/time.ts";
import { kindIcon, lineCounts, statusLetter } from "./changeFiles.ts";
import { label, monoFont, textButton, type Palette } from "./style.ts";
import { agentBlock } from "./agentPane.ts";

const DIFF_LIST = "gitdeck-diff";
const DIFF_ROW = 18;
const MAX_FILES = 500;

export interface DetailActions {
  /** Opens the file's diff in the viewer tab. */
  openFile: (path: string, cx: Context) => void;
  close: (cx: Context) => void;
  /** Every file as it was at the selected commit. */
  browseTree: (cx: Context) => void;
  /** Selects another commit (a parent). */
  jump: (hash: string, cx: Context) => void;
}

/**
 * A file row as the Changes and Review tabs draw one: its kind as an icon in its
 * status color, the name and its folder, then whatever trails (counts) and the
 * status letter again.
 */
export function fileRow(id: string, letter: string, path: string, trailing: Element[], p: Palette, onOpen?: (cx: Context) => void): Element {
  const cut = path.lastIndexOf("/");
  return h_flex()
    .id(id)
    .h(24)
    .px(10)
    .gap(6)
    .items_center()
    .when(onOpen !== undefined, (el) => el.cursor_pointer().hover((h) => h.bg(p.hover)).on_click((_e, cx) => onOpen?.(cx)))
    .child(kindIcon({ path, letter }, p))
    .child(
      h_flex()
        .flex_1()
        .min_w_0()
        .gap(6)
        .items_center()
        .child(
          div()
            .flex_shrink(1)
            .min_w_0()
            .truncate()
            .when(letter === "D", (el) => el.line_through().text_color(p.muted))
            .child(cut >= 0 ? path.slice(cut + 1) : path),
        )
        .when(cut >= 0, (el) => el.child(div().flex_1().min_w_0().truncate().text_xs().text_color(p.dim).child(path.slice(0, cut)))),
    )
    .children(trailing)
    .child(statusLetter(letter, p));
}

function counts(f: CommitFile, p: Palette): Element {
  return f.binary ? div().flex_shrink_0().text_xs().text_color(p.dim).child("binary") : lineCounts({ added: f.added, deleted: f.deleted, binary: false }, p);
}

/** The commit pane's row of tabs (Commit, File Tree) and its buttons. */
export function tabBar(p: Palette, ...buttons: Element[]): Element {
  return h_flex()
    .h(30)
    .px(6)
    .gap(2)
    .items_center()
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .children(buttons);
}

/** The author's saved picture, large, or their initials on their color. */
function face(name: string, picture: string | null, p: Palette): Element {
  if (picture !== null) return image(picture).w(40).h(40).flex_shrink_0().rounded(6);
  const { initials, color } = authorBadge(name, p.lanes.length);
  return div()
    .w(40)
    .h(40)
    .flex_shrink_0()
    .rounded(6)
    .bg(p.lanes[color] ?? p.accent)
    .flex()
    .items_center()
    .justify_center()
    .font_semibold()
    .text_color(p.surface)
    .child(initials);
}

function person(role: string, name: string, email: string, time: number, picture: string | null, p: Palette): Element {
  return h_flex()
    .gap(10)
    .items_start()
    .child(h_flex().w(64).flex_shrink_0().justify_end().child(face(name, picture, p)))
    .child(
      v_flex()
        .flex_1()
        .min_w_0()
        .gap(1)
        .child(div().text_size(10).text_color(p.dim).child(role))
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .min_w_0()
            .child(div().flex_shrink_0().font_medium().child(name))
            .child(div().min_w_0().truncate().text_xs().text_color(p.dim).child(email)),
        )
        .child(div().text_xs().text_color(p.muted).child(dateTime(time))),
    );
}

function divider(p: Palette): Element {
  return div().h(1).mx(10).my(8).flex_shrink_0().bg(p.border);
}

function commitBody(view: HistoryView, p: Palette, actions: DetailActions, avatar: (email: string) => string | null): Element[] {
  const c = view.commit;
  if (!c) return [div().p(12).text_color(p.dim).child("Reading commit…")];
  if (c.error || !c.detail) return [div().p(12).text_color(p.removed).child(c.error ?? "Commit not found")];
  const d = c.detail;
  const [subject = "", ...rest] = d.message.split("\n");
  // Wrapped by its author at ~72 columns; rejoined so the panel's own width wraps it.
  const body = rest.join("\n").trim().split(/\n{2,}/).map((par) => par.replace(/\n(?![-*•]|\d+[.)])/g, " ")).join("\n\n");
  const sameCommitter = d.committer === d.author && d.commitTime === d.time;
  const parents = d.parents.map((h, i) =>
    div()
      .id(`parent:${i}`)
      .cursor_pointer()
      .font_family(monoFont())
      .text_color(p.info)
      .underline()
      .hover((el) => el.text_color(p.accent))
      .on_click((_e, cx) => actions.jump(h, cx))
      .child(h.slice(0, 7)),
  );
  const head = v_flex()
    .px(10)
    .pt(10)
    .gap(8)
    .child(person("AUTHOR", d.author, d.email, d.time, avatar(d.email), p))
    .when(!sameCommitter, (el) => el.child(person("COMMITTER", d.committer, d.committerEmail, d.commitTime, avatar(d.committerEmail), p)))
    .child(
      v_flex()
        .gap(3)
        .text_xs()
        .child(h_flex().gap(10).items_center().child(label("SHA", p)).child(div().min_w_0().truncate().font_family(monoFont()).text_color(p.muted).child(d.hash)))
        .when(parents.length > 0, (el) =>
          el.child(h_flex().gap(10).items_center().child(label(parents.length > 1 ? "PARENTS" : "PARENT", p)).child(h_flex().gap(8).children(parents))),
        ),
    );
  const message = v_flex()
    .px(10)
    .gap(6)
    .child(div().pl(74).font_medium().child(subject))
    .when(body !== "", (el) => el.child(div().pl(74).text_xs().text_color(p.muted).child(body)));
  const files = c.files.slice(0, MAX_FILES).map((f, i) =>
    fileRow(`cf:${i}`, f.status, f.path, [counts(f, p)], p, (cx) => actions.openFile(f.path, cx)),
  );
  const title = div().px(10).pb(2).text_xs().text_color(p.dim).child(`${c.files.length} file${c.files.length === 1 ? "" : "s"} changed`);
  const agents = view.agents ?? [];
  const block = agents.length > 0 ? [divider(p), agentBlock(agents, p)] : [];
  return [head, divider(p), message, ...block, divider(p), title, ...files];
}

export function entryLetter(e: StatusEntry): string {
  if (e.kind === "untracked") return "?";
  if (e.kind === "conflict") return "!";
  if (e.kind === "renamed") return "R";
  return e.index !== "." ? e.index : e.worktree;
}

/** "staged" after a file with changes in the index. */
export function stagedTag(e: StatusEntry, p: Palette): Element[] {
  const staged = e.kind !== "untracked" && e.kind !== "conflict" && e.index !== ".";
  return staged ? [div().flex_shrink_0().text_xs().text_color(p.added).child("staged")] : [];
}

function worktreeBody(status: RepoStatus | null, p: Palette, actions: DetailActions): Element[] {
  const files = (status?.entries ?? []).filter((e) => e.kind !== "ignored");
  return files.slice(0, MAX_FILES).map((e, i) =>
    fileRow(`wf:${i}`, entryLetter(e), e.path, stagedTag(e, p), p, (cx) => actions.openFile(e.path, cx)),
  );
}

function diffRow(r: DiffRow, p: Palette, hit = false, picked = false): Element {
  const num = (n: number | null) => div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(n === null ? "" : String(n));
  const base = h_flex()
    .h(DIFF_ROW)
    .gap(6)
    .pr(8)
    .items_center()
    .whitespace_nowrap()
    .when(hit || picked, (el) => el.border_l_2().border_color(picked ? p.changed : p.accent));
  if (hit) return withHit(base, r, p);
  if (r.kind === "hunk") return base.bg(p.raised).text_color(p.info).child(div().pl(8).truncate().child(r.text));
  if (r.kind === "note") return base.text_color(p.dim).child(div().pl(8).child(r.text));
  const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
  const color = r.kind === "add" ? p.added : r.kind === "del" ? p.removed : p.foreground;
  return base
    .when(r.kind === "add", (el) => el.bg(p.addedBg))
    .when(r.kind === "del", (el) => el.bg(p.removedBg))
    .child(num(r.old))
    .child(num(r.new))
    .child(div().w(10).flex_shrink_0().text_color(color).child(mark))
    .child(div().flex_1().min_w_0().truncate().text_color(color).child(r.text === "" ? " " : r.text));
}

/** The row the find box is on: the selection color over everything, so it stands out. */
function withHit(base: Element, r: DiffRow, p: Palette): Element {
  const num = (n: number | null) => div().w(36).flex_shrink_0().text_right().text_color(p.dim).child(n === null ? "" : String(n));
  const mark = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
  const lined = r.kind !== "hunk" && r.kind !== "note";
  return lined
    ? base.bg(p.selected).child(num(r.old)).child(num(r.new)).child(div().w(10).flex_shrink_0().child(mark)).child(div().flex_1().min_w_0().truncate().child(r.text === "" ? " " : r.text))
    : base.bg(p.selected).child(div().pl(8).truncate().child(r.text));
}

/** Where find in the diff stands: the scroll it moves, and the row it is on; and the rows picked for a note. */
export interface DiffFind {
  scroll: VirtualListScrollHandle;
  hit: number | null;
  picked?: { from: number; to: number } | null;
  /** A row clicked: picks lines for a note to the agent. */
  pick?: (row: number, cx: Context) => void;
}

function side(label: string, path: string | null, p: Palette): Element {
  return v_flex()
    .flex_1()
    .min_w_0()
    .gap(4)
    .items_center()
    .child(div().text_xs().text_color(p.dim).child(label))
    .child(path === null ? div().text_xs().text_color(p.dim).child("(none)") : image(path).max_w(360).max_h(240));
}

/** A changed image's before and after, or why they can't be drawn. */
function imagePair(pair: ImagePair, p: Palette): Element {
  const box = h_flex().flex_shrink_0().p(8).gap(12).border_b_1().border_color(p.border).bg(p.chrome);
  return pair.note !== null ? box.child(div().text_xs().text_color(p.dim).child(pair.note)) : box.child(side("Before", pair.old, p)).child(side("After", pair.new, p));
}

/** A diff's rows (and a changed image's two sides), filling the space it is given. */
export function diffBody(diff: Diff | null, p: Palette, find?: DiffFind): Element {
  const rows = diff ? [...diff.rows, ...(diff.truncated ? [{ kind: "note", old: null, new: null, text: "Diff cut short: too many lines" } as DiffRow] : [])] : [];
  return v_flex()
    .flex_1()
    .min_h_0()
    .when(Boolean(diff?.images), (el) => el.child(diff?.images ? imagePair(diff.images, p) : div()))
    .child(
      diff
        ? div()
            .relative()
            .flex_1()
            .min_h_0()
            .font_family(monoFont())
            .text_xs()
            .child(
              v_virtual_list(DIFF_LIST, rows.length, DIFF_ROW, (i) => String(i), (range) =>
                rows.slice(range.start, range.end).map((r, k) => {
                  const i = range.start + k;
                  const picked = find?.picked != null && i >= find.picked.from && i <= find.picked.to;
                  return diffRow(r, p, find?.hit === i, picked);
                }),
              )
                .when(find !== undefined, (el) => (find ? el.track_scroll(find.scroll) : el))
                .when(find?.pick !== undefined, (el) => el.cursor_pointer().on_item_click((key, cx) => find?.pick?.(Number(key), cx)))
                .size_full(),
            )
            .child(Scrollbar.vertical(DIFF_LIST).absolute().inset_0())
        : div().p(12).text_color(p.dim).child("Reading diff…"),
    );
}

export function details(view: HistoryView, status: RepoStatus | null, p: Palette, actions: DetailActions, avatar: (email: string) => string | null = () => null): Element | null {
  if (view.selected === null) return null;
  const pane = v_flex().flex_1().min_h_0().border_t_1().border_color(p.border).bg(p.surface);
  const uncommitted = view.selected === UNCOMMITTED;
  const body = uncommitted ? worktreeBody(status, p, actions) : commitBody(view, p, actions, avatar);
  const tabs = uncommitted
    ? [div().flex_1().px(4).text_xs().text_color(p.muted).child("Uncommitted changes")]
    : [textButton("details-commit", "Commit", p, () => {}, true), textButton("details-tree", "File Tree", p, actions.browseTree), div().flex_1()];
  return pane
    .child(tabBar(p, ...tabs, textButton("details-close", "Close", p, actions.close)))
    .child(v_flex().id("details-body").flex_1().min_h_0().overflow_y_scrollbar().pb(6).children(body));
}
