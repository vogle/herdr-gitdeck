import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenText } from "../../src/core/agentLink/text.ts";

test("tokenText shortens large counts", () => {
  assert.equal(tokenText(812), "812 tokens");
  assert.equal(tokenText(12_400), "12.4K tokens");
  assert.equal(tokenText(2_102_302), "2.1M tokens");
  assert.equal(tokenText(1), "1 token");
});

test("promptText drops pasted-content tags and blank runs", async () => {
  const { promptText } = await import("../../src/core/agentLink/text.ts");
  assert.equal(promptText('<pasted_content id="f912">\nfix it\n</pasted_content>\n\n\n\nthanks'), "fix it\n\nthanks");
  assert.equal(promptText("  <pasted_content id=\"a\"></pasted_content>  "), "");
});

test("lineText says how many lines", async () => {
  const { lineText } = await import("../../src/core/agentLink/text.ts");
  assert.equal(lineText(1), "1 line");
  assert.equal(lineText(23), "23 lines");
});
