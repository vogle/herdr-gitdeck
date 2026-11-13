import { test } from "node:test";
import assert from "node:assert/strict";
import { openCommand, openInBrowser, safeUrl } from "../src/core/openUrl.ts";
import type { Exec } from "../src/core/git/runner.ts";

const URL_ = "https://github.com/o/r/pull/12";

test("each platform hands the link to its default browser, never through a shell", () => {
  assert.deepEqual(openCommand("macos", URL_), { command: "open", args: [URL_] });
  assert.deepEqual(openCommand("linux", URL_), { command: "xdg-open", args: [URL_] });
  assert.deepEqual(openCommand("windows", URL_), { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", URL_] });
});

test("only a plain https link is opened", () => {
  assert.equal(safeUrl(URL_), true);
  assert.equal(safeUrl("https://gitlab.com/o/r/-/merge_requests/3?a=1&b=2"), true);
  assert.equal(safeUrl("http://github.com/o/r"), false);
  assert.equal(safeUrl("file:///etc/passwd"), false);
  assert.equal(safeUrl("javascript:alert(1)"), false);
  assert.equal(safeUrl("-https://x"), false);
  assert.equal(safeUrl("https://x.com/a b"), false);
  assert.equal(safeUrl("https://x.com/a\nb"), false);
  assert.equal(safeUrl("https://"), false);
  assert.equal(safeUrl('https://x.com/a"&calc'), false);
  assert.equal(safeUrl("https://x.com:8443/a"), true);
  assert.equal(openCommand("macos", "file:///etc/passwd"), null);
});

test("openInBrowser runs the command on this machine; it fails only when the command can't start", async () => {
  const calls: unknown[][] = [];
  const exec: Exec = async (command, args, options) => {
    calls.push([command, args, options]);
    return { code: 1, stdout: "", stderr: "" };
  };
  assert.equal(await openInBrowser(exec, "windows", URL_), null);
  assert.deepEqual(calls, [["rundll32.exe", ["url.dll,FileProtocolHandler", URL_], { on: null }]]);
  assert.match((await openInBrowser(exec, "macos", "file:///x")) ?? "", /Won't open/);
  const missing: Exec = async () => {
    throw new Error("not installed");
  };
  assert.match((await openInBrowser(missing, "linux", URL_)) ?? "", /Couldn't open a browser \(xdg-open\): not installed/);
});
