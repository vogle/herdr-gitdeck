// Self-update: once a day, ask GitHub for the latest release; when it is newer,
// post a notification whose click runs `gitdeck.update`, which installs it.
// Nothing is installed without that click.
import { exec, home, notify } from "herdr";
import { readFile, writeFile } from "fs/promises";
import { isNewer, readRelease, RELEASES_API, shouldCheck, type Release } from "./core/update.ts";

/** Set by scripts/build.mjs from package.json. */
declare const __GITDECK_VERSION__: string;
export const VERSION: string = __GITDECK_VERSION__;

/** How long the update notification stays up (ms). */
const NOTICE_MS = 10 * 60 * 1000;
/** Shown on every update notification, so it reads as GitDeck's. */
const ICON = "mods/gitdeck/icons/logo.svg";
const MODS = () => `${home()}/.config/herdr-app/mods`;
/** Hidden (the app doesn't watch it) and outside gitdeck/, so an update keeps it. Shared by every copy. */
const STATE = () => `${MODS()}/.gitdeck-update.json`;

// The same steps as scripts/dev-install.sh, after a download: put the new folder
// together in a hidden stage, check it, then swap it in with one rename. Any
// failure leaves the installed version as it was. The URL arrives as $1, never
// inside the script text.
const INSTALL = `
set -eu
APP_HOME="\${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
DEST="$APP_HOME/mods/gitdeck"
STAGE="$APP_HOME/mods/.gitdeck-stage"
OLD="$APP_HOME/mods/.gitdeck-old"
TMP="$APP_HOME/mods/.gitdeck-download"
die() { rm -rf "$TMP" "$STAGE"; printf '%s\\n' "$*" >&2; exit 1; }
grep -qi '"title": *"gitdeck"' "$DEST/mod.json" 2>/dev/null || die "gitdeck isn't installed at $DEST"
rm -rf "$TMP" "$STAGE" "$OLD"
mkdir -p "$TMP"
curl -fsSL --max-time 20 -o "$TMP/gitdeck.tar.gz" "$1" || die "download failed"
tar -xzf "$TMP/gitdeck.tar.gz" -C "$TMP" gitdeck || die "not a gitdeck release"
[ -f "$TMP/gitdeck/main.js" ] && [ -f "$TMP/gitdeck/mod.json" ] || die "not a gitdeck release"
mv "$TMP/gitdeck" "$STAGE"
rm -rf "$TMP"
if command -v herdr-app >/dev/null 2>&1; then
  herdr-app check "$STAGE" >/dev/null || die "the new version failed herdr-app check"
fi
mv "$DEST" "$OLD"
mv "$STAGE" "$DEST"
rm -rf "$OLD"
`;

/** The release found by the last check, when it is newer than this copy. */
let pending: Release | null = null;

async function lastChecked(): Promise<number | null> {
  try {
    const at = (JSON.parse(await readFile(STATE(), "utf8")) as { checkedAt?: unknown }).checkedAt;
    return typeof at === "number" ? at : null;
  } catch {
    return null; // Never checked, or the file is unreadable: check now.
  }
}

/** The latest release when it is newer than this copy; null when not, or when GitHub can't be reached. */
async function newerRelease(): Promise<Release | null> {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "gitdeck" } });
    const release = res.ok ? readRelease(await res.json()) : null;
    return release && isNewer(release.version, VERSION) ? release : null;
  } catch {
    return null; // Offline or GitHub unreachable.
  }
}

/** Asks GitHub when a day has passed, and posts the notification for a newer release. */
export async function checkForUpdate(now = Date.now()): Promise<void> {
  if (!shouldCheck(now, await lastChecked())) return;
  // Claim the check first so other copies of the mod don't ask (and notify) too.
  await writeFile(STATE(), JSON.stringify({ checkedAt: now })).catch(() => {});
  const release = await newerRelease();
  if (!release) return;
  pending = release;
  notify({
    title: `GitDeck ${release.version} is out`,
    body: `You have ${VERSION}. Click to update, or run: herdr-app do gitdeck.update`,
    level: "info",
    icon: ICON,
    timeout: NOTICE_MS,
    action: { name: "gitdeck.update" },
  });
}

/** Installs the newest release: the notification's click, or `herdr-app do gitdeck.update` at any time. */
export async function installUpdate(): Promise<void> {
  // A missed notification, a restart or another copy's check leaves nothing pending: ask now.
  const release = pending ?? (await newerRelease());
  if (!release) {
    notify({ title: `GitDeck ${VERSION} is up to date`, level: "success", icon: ICON });
    return;
  }
  try {
    const r = await exec("sh", ["-c", INSTALL, "gitdeck-update", release.asset]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
    pending = null;
    notify({ title: `GitDeck updated to ${release.version}`, level: "success", icon: ICON });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    notify({ title: "GitDeck update failed", body: `${reason}. Your version is unchanged.`, level: "error", icon: ICON });
  }
}
