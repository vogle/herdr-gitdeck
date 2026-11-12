// Self-update: once a day, ask GitHub for the latest release; when it is newer,
// post a notification whose click runs `gitdeck.update`, which installs it.
// Nothing is installed without that click.
import { exec, home, notify } from "herdr";
import { readFile, writeFile } from "fs/promises";
import { isNewer, readRelease, RELEASES_API, shouldCheck, type Release } from "./core/update.ts";

/** Set by scripts/build.mjs from package.json. */
declare const __GITDECK_VERSION__: string;
export const VERSION: string = __GITDECK_VERSION__;

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

/** Asks GitHub when a day has passed, and posts the notification for a newer release. */
export async function checkForUpdate(now = Date.now()): Promise<void> {
  if (!shouldCheck(now, await lastChecked())) return;
  // Claim the check first so other copies of the mod don't ask (and notify) too.
  await writeFile(STATE(), JSON.stringify({ checkedAt: now })).catch(() => {});
  let release: Release | null = null;
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "gitdeck" } });
    release = res.ok ? readRelease(await res.json()) : null;
  } catch {
    return; // Offline or GitHub unreachable: try again tomorrow.
  }
  if (!release || !isNewer(release.version, VERSION)) return;
  pending = release;
  notify({
    title: `gitdeck ${release.version} is out`,
    body: `You have ${VERSION}. Click to update.`,
    level: "info",
    action: { name: "gitdeck.update" },
  });
}

/** Installs the release the last check found (the notification's click). */
export async function installUpdate(): Promise<void> {
  const release = pending;
  if (!release) return;
  try {
    const r = await exec("sh", ["-c", INSTALL, "gitdeck-update", release.asset]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`);
    pending = null;
    notify({ title: `gitdeck updated to ${release.version}`, level: "success" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    notify({ title: "gitdeck update failed", body: `${reason}. Your version is unchanged.`, level: "error" });
  }
}
