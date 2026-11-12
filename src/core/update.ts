// Self-update: is there a newer gitdeck release, and where is its download.
// Pure; src/updater.ts does the fetching, the notification and the install.

/** The release asset: a tar.gz holding the gitdeck/ mod folder. */
export const ASSET_NAME = "gitdeck.tar.gz";
/** Where releases are read from, and the only place a download may come from. */
export const RELEASES_API = "https://api.github.com/repos/vogle/herdr-gitdeck/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/vogle/herdr-gitdeck/releases/download/";
/** One check a day, shared by every copy of the mod. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface Release {
  /** "0.2.0", without the tag's leading v. */
  version: string;
  /** The tar.gz to install. */
  asset: string;
  /** The release page, for what changed. */
  page: string;
}

/** [major, minor, patch] from "1.2.3" or "v1.2.3"; null for anything else (pre-releases too). */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `latest` is a higher version than `current`. Unreadable versions never are. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The release from GitHub's releases/latest answer, or null when it isn't one we would install. */
export function readRelease(json: unknown): Release | null {
  if (!isRecord(json) || json.draft === true || json.prerelease === true) return null;
  const tag = json.tag_name;
  const page = json.html_url;
  if (typeof tag !== "string" || typeof page !== "string" || !parseVersion(tag)) return null;
  if (!Array.isArray(json.assets)) return null;
  const asset = json.assets.find((a): a is Record<string, unknown> => isRecord(a) && a.name === ASSET_NAME);
  const url = asset?.browser_download_url;
  if (typeof url !== "string" || !url.startsWith(DOWNLOAD_PREFIX)) return null;
  return { version: tag.replace(/^v/, ""), asset: url, page };
}

/** Whether a day has passed since `last` (ms); a clock that went back counts as due. */
export function shouldCheck(now: number, last: number | null): boolean {
  return last === null || now - last >= CHECK_EVERY_MS || now < last;
}
