// A file as it is at a commit, in the viewer tab: source in Herdr's read-only
// code view (colored by language, with line numbers and folding, as the Files
// tab shows it), markdown drawn rendered unless its source is asked for, and
// an image drawn as a picture.

import { div, image, type Element } from "gpui-kit";
import { Editor, EditorState, TextView, v_flex } from "gpui-base";
import { theme } from "herdr";
import { codeLanguage } from "../core/codeView.ts";
import type { BlobView } from "../core/tree.ts";
import { monoFont, type Palette } from "./style.ts";

/** The code view's colors, from the shell theme's ANSI colors (the Files tab's choice). */
function syntax(): Record<string, string> {
  const t = theme() as unknown as Record<string, string | undefined>;
  const of = (name: string, fallback: string) => t[name] ?? fallback;
  return {
    keyword: of("ansi5", "#c678dd"),
    string: of("ansi2", "#98c379"),
    comment: of("dim", "#707070"),
    function: of("ansi4", "#61afef"),
    type: of("ansi3", "#e5c07b"),
    number: of("ansi1", "#d19a66"),
    constant: of("ansi6", "#56b6c2"),
    boolean: of("ansi6", "#56b6c2"),
  };
}

/** The read-only code view of a file's text. A live host call: make it when the file is read, never in render, and release it when the view moves on. */
export function codeState(path: string, blob: BlobView): EditorState | null {
  if (blob.note) return null;
  return EditorState.new({
    language: codeLanguage(path),
    value: blob.lines.join("\n"),
    readonly: true,
    font_family: monoFont(),
    font_size: 12,
    syntax: syntax(),
  });
}

/** A file drawn as a picture: its path for `image()`, or why it isn't drawn. */
export interface Picture {
  path: string | null;
  note: string | null;
}

/** The file, as source or rendered: markdown as text, SVG as its picture. */
export function fileBody(blob: BlobView, code: EditorState | null, rendered: boolean, picture: Picture | null, p: Palette): Element {
  if (blob.note) return div().p(12).text_color(p.dim).child(blob.note);
  if (rendered && picture) return vectorBody(picture, p);
  if (rendered) {
    return div()
      .flex_1()
      .min_h_0()
      .px(24)
      .py(16)
      .child(TextView.markdown("gitdeck-markdown", blob.lines.join("\n")).selectable().scrollable().size_full());
  }
  return code ? Editor.new(code).flex_1().min_h_0() : div().p(12).text_color(p.dim).child("Reading…");
}

/** An image at its own size, shrunk to fit the tab, centred. */
export function imageBody(path: string | null, note: string | null, p: Palette): Element {
  if (path === null) return div().p(12).text_color(p.dim).child(note ?? "No picture");
  return v_flex()
    .flex_1()
    .min_h_0()
    .p(24)
    .items_center()
    .justify_center()
    .overflow_hidden()
    .child(image(path).max_w_full().max_h_full());
}

/** The light card an SVG is drawn on: icons draw their lines in black (currentColor), unseen on a dark tab. */
const CARD = "#f4f4f5";

/** An SVG fitted to the tab on a light card, its shape kept: it is written large, so it stays sharp. */
function vectorBody(picture: Picture, p: Palette): Element {
  if (picture.path === null) return div().p(12).text_color(p.dim).child(picture.note ?? "No picture");
  return v_flex()
    .flex_1()
    .min_h_0()
    .p(24)
    .items_center()
    .justify_center()
    .child(
      div()
        .w_full()
        .h_full()
        .p(32)
        .rounded(8)
        .bg(CARD)
        .child(image(picture.path).size_full()),
    );
}
