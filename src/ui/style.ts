// Theme access and small shared pieces. Colors always come from the person's theme.

import { div, svg, type Color, type Context, type Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, theme } from "herdr";
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
} as const;

export function icon(path: string, color: Color, size = 14): Element {
  return svg(path).w(size).h(size).flex_shrink_0().text_color(color);
}

/** A small count with a colored mark, e.g. "● 3". Nothing for zero. */
export function badge(mark: string, count: number, color: Color, title: string): Element[] {
  if (count <= 0) return [];
  return [h_flex().gap(3).items_center().flex_shrink_0().tooltip(title).child(div().text_color(color).child(mark)).child(div().child(String(count)))];
}

/** The terminal font, for hashes and diffs. */
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
