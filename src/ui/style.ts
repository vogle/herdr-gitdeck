// Theme access and small shared pieces. Colors always come from the person's theme.

import { div, svg, type Color, type Context, type Element, type NativeElement } from "gpui-kit";
import { h_flex, Input, type InputState } from "gpui-base";
import { clearsOnEscape, showsClear } from "../core/searchBox.ts";
import { settings, theme } from "herdr";
import type { FileKind } from "../core/fileKind.ts";
import type { AgentStatus } from "../core/repoAgents.ts";

export interface Palette {
  surface: Color;
  chrome: Color;
  raised: Color;
  hover: Color;
  selected: Color;
  border: Color;
  foreground: Color;
  muted: Color;
  dim: Color;
  accent: Color;
  added: Color;
  changed: Color;
  removed: Color;
  info: Color;
  addedBg: Color;
  removedBg: Color;
  /** Graph lane colors, in turn. */
  lanes: readonly Color[];
}

const pick = (t: Record<string, string>, name: string, fallback: Color): Color => {
  const value = t[name];
  return value && value.startsWith("#") ? (value as Color) : fallback;
};

/** A color at low opacity, as #rrggbbaa, for a diff line's background. */
function tint(color: Color): Color {
  return (color.length === 7 ? `${color}26` : color) as Color;
}

export function palette(): Palette {
  const t = theme();
  return {
    surface: pick(t, "surface", "#1e1e1e"),
    chrome: pick(t, "chrome", "#181818"),
    raised: pick(t, "raised", "#2a2a2a"),
    hover: pick(t, "hover", "#2f2f2f"),
    selected: pick(t, "selected", "#37373d"),
    border: pick(t, "border", "#333333"),
    foreground: pick(t, "foreground", "#e6e6e6"),
    muted: pick(t, "muted", "#a0a0a0"),
    dim: pick(t, "dim", "#707070"),
    accent: pick(t, "accent", "#4c8dff"),
    added: pick(t, "ansi2", "#3fb950"),
    changed: pick(t, "ansi3", "#d29922"),
    removed: pick(t, "ansi1", "#f85149"),
    info: pick(t, "ansi4", "#58a6ff"),
    addedBg: tint(pick(t, "ansi2", "#3fb950")),
    removedBg: tint(pick(t, "ansi1", "#f85149")),
    lanes: [
      pick(t, "ansi4", "#58a6ff"),
      pick(t, "ansi2", "#3fb950"),
      pick(t, "ansi5", "#bc8cff"),
      pick(t, "ansi3", "#d29922"),
      pick(t, "ansi6", "#39c5cf"),
      pick(t, "ansi1", "#f85149"),
      pick(t, "ansi12", "#79c0ff"),
      pick(t, "ansi10", "#56d364"),
      pick(t, "ansi13", "#d2a8ff"),
      pick(t, "ansi11", "#e3b341"),
      pick(t, "ansi14", "#56d4dd"),
      pick(t, "ansi9", "#ff7b72"),
    ],
  };
}

export const ICONS = {
  refresh: "mods/gitdeck/icons/refresh.svg",
  chevron: "mods/gitdeck/icons/chevron-down.svg",
  branch: "mods/gitdeck/icons/branch.svg",
  herd: "mods/gitdeck/icons/herd.svg",
  stage: "mods/gitdeck/icons/plus.svg",
  unstage: "mods/gitdeck/icons/minus.svg",
  discard: "mods/gitdeck/icons/undo.svg",
  delete: "mods/gitdeck/icons/trash.svg",
  ignore: "mods/gitdeck/icons/eye-off.svg",
  unignore: "mods/gitdeck/icons/eye.svg",
  lines: "mods/gitdeck/icons/scissors.svg",
  pr: "mods/gitdeck/icons/pull-request.svg",
  external: "mods/gitdeck/icons/external.svg",
  folder: "mods/gitdeck/icons/folder.svg",
  folderOpen: "mods/gitdeck/icons/folder-open.svg",
  check: "mods/gitdeck/icons/check.svg",
  tag: "mods/gitdeck/icons/tag.svg",
  github: "mods/gitdeck/icons/forge-github.svg",
  gitlab: "mods/gitdeck/icons/forge-gitlab.svg",
  git: "mods/gitdeck/icons/forge-git.svg",
  agent: "mods/gitdeck/icons/terminal.svg",
  clear: "mods/gitdeck/icons/x.svg",
} as const;

/** A changed file's icon by its kind (Lucide, see icons/LICENSE-lucide.txt); its color says its status. */
export const FILE_ICONS: Readonly<Record<FileKind, string>> = {
  code: "mods/gitdeck/icons/file-code.svg",
  text: "mods/gitdeck/icons/file-text.svg",
  json: "mods/gitdeck/icons/file-braces.svg",
  config: "mods/gitdeck/icons/file-sliders.svg",
  lock: "mods/gitdeck/icons/file-lock.svg",
  image: "mods/gitdeck/icons/file-image.svg",
  terminal: "mods/gitdeck/icons/file-terminal.svg",
  file: "mods/gitdeck/icons/file.svg",
};

export function icon(path: string, color: Color, size = 14): Element {
  return svg(path).w(size).h(size).flex_shrink_0().text_color(color);
}

/** A small count with a colored mark, e.g. "● 3". Nothing for zero. */
export function badge(mark: string, count: number, color: Color, title: string): Element[] {
  if (count <= 0) return [];
  return [h_flex().gap(3).items_center().flex_shrink_0().tooltip(title).child(div().text_color(color).child(mark)).child(div().child(String(count)))];
}

/** The terminal font, for hashes and diffs. */
/** A label in small capitals, right-aligned in a column of its own, as Fork lays the commit out. */
export function label(text: string, p: Palette): Element {
  return div().w(64).flex_shrink_0().text_right().text_size(10).text_color(p.dim).child(text);
}

export function monoFont(): string {
  const f = settings().font_family;
  return typeof f === "string" && f !== "" ? f : "Menlo";
}

/** A small icon button for a row action, named by its tooltip. Its click stays with it, like textButton's. */
export function iconButton(id: string, path: string, tip: string, p: Palette, onClick: (cx: Context) => void): Element {
  return div()
    .id(id)
    .p(4)
    .rounded(4)
    .flex_shrink_0()
    .cursor_pointer()
    .tooltip(tip)
    .hover((el) => el.bg(p.hover))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(icon(path, p.muted, 14));
}

/**
 * A search box's frame, its input, and an × at the right end while it holds text.
 * The × and Esc empty it and keep the cursor in it; `onClear` then does what typing would.
 * Esc on an empty box goes on to the panel (Back). The caller sizes the frame and picks its background.
 */
export function searchBox(id: string, state: InputState, p: Palette, onClear: (cx: Context) => void): NativeElement {
  const clear = (cx: Context) => {
    state.set_value("");
    state.focus();
    onClear(cx);
  };
  return h_flex()
    .id(id)
    .items_center()
    .gap(2)
    .pl(6)
    .pr(2)
    .rounded(4)
    .border_1()
    .border_color(p.border)
    .on_key_down((e, cx) => {
      if (!clearsOnEscape(e.keystroke, state.value())) return;
      cx.stop_propagation();
      clear(cx);
    })
    .child(div().flex_1().min_w_0().h_full().child(Input.new(state).size_full().text_xs().text_color(p.foreground)))
    .when(showsClear(state.value()), (el) =>
      el.child(
        div()
          .id(`${id}-clear`)
          .flex_shrink_0()
          .p(2)
          .rounded(3)
          .cursor_pointer()
          .tooltip("Clear")
          .hover((h) => h.bg(p.hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            clear(cx);
          })
          .child(icon(ICONS.clear, p.dim, 12)),
      ),
    );
}

/**
 * A small clickable text button. Its click stays with it: a button in a clickable row doesn't also click the row.
 * A disabled one is dimmed and ignores clicks: there is nothing for it to do yet.
 */
export function textButton(id: string, label: string, p: Palette, onClick: (cx: Context) => void, active = false, enabled = true): Element {
  if (!enabled) return div().id(id).px(8).py(2).rounded(4).flex_shrink_0().text_xs().text_color(p.dim).child(label);
  return div()
    .id(id)
    .px(8)
    .py(2)
    .rounded(4)
    .flex_shrink_0()
    .cursor_pointer()
    .text_xs()
    .text_color(active ? p.foreground : p.muted)
    .when(active, (el) => el.bg(p.selected))
    .hover((el) => el.bg(p.hover).text_color(p.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(label);
}

/** An agent's state as a dot color: working, needs you, done, idle. */
export function agentColor(status: AgentStatus, p: Palette): Palette["added"] {
  return status === "working" ? p.changed : status === "blocked" ? p.removed : status === "done" ? p.added : p.dim;
}

/**
 * How loud an agent's state reads in the header: needing you is a filled badge, working
 * and done a pale one in their color, idle stays plain (null) so the others stand out.
 */
export function agentBadge(status: AgentStatus, p: Palette): { bg: Color; fg: Color; dot: Color } | null {
  if (status === "blocked") return { bg: p.removed, fg: p.surface, dot: p.surface };
  if (status === "idle") return null;
  const color = agentColor(status, p);
  return { bg: tint(color.slice(0, 7) as Color), fg: color, dot: color };
}
