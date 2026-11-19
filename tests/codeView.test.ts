import { test } from "node:test";
import assert from "node:assert/strict";
import { codeLanguage, isMarkdown, isSvg, markdownWithoutImages } from "../src/core/codeView.ts";

test("codeLanguage names the highlighter's language from the extension, as the Files tab does", () => {
  assert.equal(codeLanguage("src/a.ts"), "js");
  assert.equal(codeLanguage("A.TSX"), "js");
  assert.equal(codeLanguage("x.mjs"), "js");
  assert.equal(codeLanguage("Cargo.toml"), "yaml");
  assert.equal(codeLanguage("tsconfig.jsonc"), "json");
  assert.equal(codeLanguage("App.vue"), "html");
  assert.equal(codeLanguage("main.rs"), "rs");
  assert.equal(codeLanguage("dir.v2/Makefile"), "txt", "no extension: plain text");
  assert.equal(codeLanguage(".gitignore"), "txt");
});

test("isMarkdown is true for markdown files only", () => {
  assert.equal(isMarkdown("README.md"), true);
  assert.equal(isMarkdown("docs/Guide.MARKDOWN"), true);
  assert.equal(isMarkdown("notes.mdx"), true);
  assert.equal(isMarkdown("a.ts"), false);
  assert.equal(isMarkdown("md"), false);
});

test("isSvg is true for SVG files only", () => {
  assert.equal(isSvg("icons/A.SVG"), true);
  assert.equal(isSvg("svg"), false);
  assert.equal(isSvg("a.svgz"), false);
});

test("markdownWithoutImages: pictures become links, so opening a file fetches nothing", () => {
  assert.equal(markdownWithoutImages("a ![logo](https://t.example/p.png) b"), "a [logo](https://t.example/p.png) b");
  assert.equal(markdownWithoutImages("![][ref]\n\n[ref]: https://t.example/p.png"), "[image][ref]\n\n[ref]: https://t.example/p.png", "a reference picture, with no alt text");
  assert.equal(markdownWithoutImages('x <img src="https://t.example/p.png" alt="badge"> y'), "x [badge](https://t.example/p.png) y", "an HTML picture");
  assert.equal(markdownWithoutImages("<IMG SRC='a.png'>"), "[image](a.png)");
  assert.equal(markdownWithoutImages("\\![not a picture](x)"), "\\![not a picture](x)", "an escaped bang stays");
});

test("markdownWithoutImages leaves code blocks as written", () => {
  const md = "```\n![x](y)\n<img src=\"z\">\n```\n~~~js\n![a](b)\n~~~\n![c](d)";
  assert.equal(markdownWithoutImages(md), "```\n![x](y)\n<img src=\"z\">\n```\n~~~js\n![a](b)\n~~~\n[c](d)");
});
