// The shown repo: where it stands against its upstream, and its changed files.
// M1 puts the commit graph here; for now this is the working tree at a glance.

import { div, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { RepoStatus, StatusEntry } from "../core/git/status.ts";
import { selectedRepo, type HerdState } from "../core/herd.ts";
import type { Palette } from "./style.ts";

const MAX_FILES = 300;

function letter(e: StatusEntry): string {
  if (e.kind === "untracked") return "U";
  if (e.kind === "conflict") return "!";
  if (e.kind === "renamed") return "R";
  const side = e.index !== "." ? e.index : e.worktree;
  return side === "?" ? "U" : side;
}

function letterColor(e: StatusEntry, p: Palette) {
  const l = letter(e);
  if (l === "!" || l === "D") return p.removed;
  if (l === "A" || l === "U") return p.added;
  if (l === "R") return p.info;
  return p.changed;
}

function fileRow(e: StatusEntry, p: Palette): Element {
  const cut = e.path.lastIndexOf("/");
  const folder = cut >= 0 ? e.path.slice(0, cut + 1) : "";
  const name = cut >= 0 ? e.path.slice(cut + 1) : e.path;
  const staged = e.kind !== "untracked" && e.kind !== "conflict" && e.index !== ".";
  return h_flex()
    .h(24)
    .px(10)
    .gap(8)
    .items_center()
    .child(div().w(12).flex_shrink_0().text_color(letterColor(e, p)).child(letter(e)))
    .child(div().flex_shrink_0().text_color(p.foreground).child(name))
    .child(div().min_w_0().truncate().text_color(p.dim).child(folder))
    .child(div().flex_1())
    .when(staged, (el) => el.child(div().text_xs().text_color(p.added).child("staged")));
}

function line(label: string, value: string, p: Palette): Element {
  return h_flex()
    .gap(8)
    .child(div().w(72).flex_shrink_0().text_color(p.dim).child(label))
    .child(div().min_w_0().truncate().text_color(p.muted).child(value));
}

function centered(p: Palette, ...lines: (string | Element)[]): Element {
  return v_flex().flex_1().items_center().justify_center().gap(6).text_color(p.dim).children(lines);
}

function facts(path: string, s: RepoStatus, p: Palette): Element {
  const tracking = s.upstream ? `${s.upstream}  ↑${s.ahead} ↓${s.behind}` : "no upstream";
  return v_flex()
    .p(12)
    .gap(4)
    .flex_shrink_0()
    .border_b_1()
    .border_color(p.border)
    .child(line("folder", path, p))
    .child(line("head", s.oid ? s.oid.slice(0, 10) : "no commits yet", p))
    .child(line("upstream", tracking, p))
    .when(s.stash > 0, (el) => el.child(line("stashes", String(s.stash), p)));
}

function fileList(s: RepoStatus, p: Palette): Element[] {
  const files = s.entries.filter((e) => e.kind !== "ignored");
  const title = files.length === 0 ? "Working tree clean" : `${files.length} changed file${files.length === 1 ? "" : "s"}`;
  return [
    div().px(10).pt(10).pb(4).text_xs().text_color(p.dim).child(title),
    v_flex()
      .id("files")
      .flex_1()
      .min_h_0()
      .overflow_y_scrollbar()
      .pb(8)
      .children(files.slice(0, MAX_FILES).map((e) => fileRow(e, p)))
      .when(files.length > MAX_FILES, (el) =>
        el.child(div().px(10).py(6).text_xs().text_color(p.dim).child(`… and ${files.length - MAX_FILES} more`)),
      ),
  ];
}

export function summary(state: HerdState, p: Palette, searching: boolean): Element {
  const repo = selectedRepo(state);
  if (!repo && searching) return centered(p, "Looking for repositories…");
  if (!repo) return centered(p, "No git repository here", div().text_xs().child(state.root ?? "Focus a terminal in a repo"));
  const result = state.statuses[repo.path];
  if (!result) return centered(p, "Reading…");
  if (!result.status) return v_flex().flex_1().p(14).text_color(p.removed).child(result.error ?? "git status failed");
  return v_flex().flex_1().min_h_0().child(facts(repo.path, result.status, p)).children(fileList(result.status, p));
}
