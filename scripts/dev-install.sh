#!/bin/sh
# Installs dist/gitdeck into the Herdr app's mods/gitdeck.
#
# The app reloads a mod on every file it sees change, so the new build is put
# together in a hidden folder (the app doesn't watch those), checked with
# `herdr-app check`, and swapped in with one rename. A failed check leaves the
# installed version as it was. Nothing outside mods/gitdeck is touched.
set -eu

APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
SRC="dist/gitdeck"
DEST="$APP_HOME/mods/gitdeck"
STAGE="$APP_HOME/mods/.gitdeck-stage"
OLD="$APP_HOME/mods/.gitdeck-old"

die() { printf 'dev-install: %s\n' "$*" >&2; exit 1; }

[ -f "$SRC/main.js" ] || die "no $SRC/main.js: run pnpm build first"
[ -d "$APP_HOME/mods" ] || die "no Herdr app home at $APP_HOME"
command -v herdr-app >/dev/null 2>&1 || die "herdr-app not on PATH"
if [ -e "$DEST" ] && ! grep -q '"title": *"gitdeck"' "$DEST/mod.json" 2>/dev/null; then
  die "$DEST exists and isn't gitdeck's; not touching it"
fi

rm -rf "$STAGE" "$OLD"
cp -R "$SRC" "$STAGE"
herdr-app check "$STAGE" >/dev/null || { rm -rf "$STAGE"; die "herdr-app check failed (installed version unchanged)"; }

# Skip the swap (and the reload) when nothing changed. The app writes its own
# files into a mod folder (jsconfig.json, .d.ts, hidden ones): not ours to compare.
if [ -d "$DEST" ] && diff -rq -x jsconfig.json -x '*.d.ts' -x '.*' "$STAGE" "$DEST" >/dev/null 2>&1; then
  rm -rf "$STAGE"
  printf 'dev-install: unchanged\n'
  exit 0
fi

[ -d "$DEST" ] && mv "$DEST" "$OLD"
mv "$STAGE" "$DEST"
rm -rf "$OLD"
printf 'dev-install: installed %s\n' "$DEST"
