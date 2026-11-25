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

const Z = "\u200b";

test("markdownWithoutImages: a picture becomes a link, so opening a file fetches nothing", () => {
  assert.equal(markdownWithoutImages("a ![logo](https://t.example/p.png) b"), `a !${Z}[logo](https://t.example/p.png) b`);
  assert.equal(markdownWithoutImages("![a [nested] alt](u)"), `!${Z}[a [nested] alt](u)`, "brackets in the alt text");
  assert.equal(markdownWithoutImages("![multi\nline](u)"), `!${Z}[multi\nline](u)`, "a picture over two lines");
  assert.equal(markdownWithoutImages("\\\\![x](u)"), `\\\\!${Z}[x](u)`, "an escaped backslash before it");
  assert.equal(markdownWithoutImages("![][ref]\n\n[ref]: https://t.example/p.png"), `!${Z}[][ref]\n\n[ref]: https://t.example/p.png`);
});

test("markdownWithoutImages: HTML that can fetch is shown as text; plain formatting stays", () => {
  assert.equal(markdownWithoutImages('<img src="https://t.example/p.png">'), `<${Z}img src="https://t.example/p.png">`);
  assert.equal(markdownWithoutImages("<IMG\nsrc=x>"), `<${Z}IMG\nsrc=x>`, "any case, over two lines");
  assert.equal(markdownWithoutImages('<picture><source srcset="u"></picture>'), `<${Z}picture><${Z}source srcset="u"></${Z}picture>`);
  assert.equal(markdownWithoutImages("<video poster=u></video><svg><image href=u/></svg>"), `<${Z}video poster=u></${Z}video><${Z}svg><${Z}image href=u/></${Z}svg>`);
  assert.equal(markdownWithoutImages('<p align="center"><b>hi</b><br/></p>'), '<p align="center"><b>hi</b><br/></p>', "formatting tags stay");
  assert.equal(markdownWithoutImages("a < b and 1<2"), "a < b and 1<2", "a bare < is no tag");
});
