import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewer, parseVersion, readRelease, shouldCheck, ASSET_NAME, CHECK_EVERY_MS } from "../src/core/update.ts";

test("parseVersion reads x.y.z with or without a leading v", () => {
  assert.deepEqual(parseVersion("0.1.0"), [0, 1, 0]);
  assert.deepEqual(parseVersion("v1.12.3"), [1, 12, 3]);
  assert.equal(parseVersion("1.2"), null);
  assert.equal(parseVersion("1.2.3-beta"), null, "pre-releases are not offered");
  assert.equal(parseVersion(""), null);
});

test("isNewer compares each part as a number", () => {
  assert.equal(isNewer("0.2.0", "0.1.0"), true);
  assert.equal(isNewer("v0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.1.0", "0.1.0"), false);
  assert.equal(isNewer("0.1.0", "0.2.0"), false, "never downgrades");
  assert.equal(isNewer("junk", "0.1.0"), false);
  assert.equal(isNewer("0.2.0", "junk"), false);
});

const URL_OK = `https://github.com/vogle/herdr-gitdeck/releases/download/v0.2.0/${ASSET_NAME}`;

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: "v0.2.0",
  html_url: "https://github.com/vogle/herdr-gitdeck/releases/tag/v0.2.0",
  draft: false,
  prerelease: false,
  assets: [{ name: ASSET_NAME, browser_download_url: URL_OK }],
  ...over,
});

test("readRelease takes the version and the gitdeck asset", () => {
  assert.deepEqual(readRelease(release()), {
    version: "0.2.0",
    asset: URL_OK,
    page: "https://github.com/vogle/herdr-gitdeck/releases/tag/v0.2.0",
  });
});

test("readRelease refuses anything it can't trust or use", () => {
  assert.equal(readRelease(null), null);
  assert.equal(readRelease("x"), null);
  assert.equal(readRelease(release({ draft: true })), null);
  assert.equal(readRelease(release({ prerelease: true })), null);
  assert.equal(readRelease(release({ tag_name: "nightly" })), null);
  assert.equal(readRelease(release({ assets: [] })), null);
  assert.equal(readRelease(release({ assets: "x" })), null);
  assert.equal(
    readRelease(release({ assets: [{ name: ASSET_NAME, browser_download_url: "https://evil.example/gitdeck.tar.gz" }] })),
    null,
    "only downloads from this repo's releases",
  );
  assert.equal(
    readRelease(release({ assets: [{ name: ASSET_NAME, browser_download_url: "https://github.com/someone/else/releases/download/v0.2.0/gitdeck.tar.gz" }] })),
    null,
  );
  assert.equal(readRelease(release({ html_url: 5 })), null);
});

test("shouldCheck waits a day between checks", () => {
  const now = 10 * CHECK_EVERY_MS;
  assert.equal(shouldCheck(now, null), true, "never checked");
  assert.equal(shouldCheck(now, now - CHECK_EVERY_MS), true);
  assert.equal(shouldCheck(now, now - CHECK_EVERY_MS + 1), false);
  assert.equal(shouldCheck(now, now + 60_000), true, "a clock that went back checks again");
});
