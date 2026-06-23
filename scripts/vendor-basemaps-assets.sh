#!/usr/bin/env bash
#
# Vendor Protomaps basemap fonts + sprites into public/basemaps-assets/.
#
# We self-host these assets instead of referencing
# https://protomaps.github.io/basemaps-assets at runtime, so the maps don't
# depend on a third-party GitHub Pages host (no SLA) and the assets stay pinned
# in lockstep with the installed @protomaps/basemaps version (which generates
# layer specs that reference these exact fontstacks and sprite icon names). The
# vector tiles themselves still come from the keyed api.protomaps.com v4 API.
#
# Run after bumping @protomaps/basemaps (and bump ASSETS_SHA below to a current
# protomaps/basemaps-assets commit):
#
#   pnpm vendor:basemaps
#
set -euo pipefail

# Pinned protomaps/basemaps-assets commit. Bump when refreshing the assets.
ASSETS_SHA="028c18f713baecad011301ff7a69acc39bcc2ae7"
# Basemap flavor used by the app's MapLibre styles.
FLAVOR="white"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$REPO_ROOT/public/basemaps-assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Determining fontstacks used by the '$FLAVOR' flavor"
# text-font can be a plain string array or an expression that evaluates to one,
# so walk the structure, collect all-string arrays, and keep real font names.
FONTSTACKS=()
while IFS= read -r line; do
  [ -n "$line" ] && FONTSTACKS+=("$line")
done < <(cd "$REPO_ROOT" && node --input-type=module -e "
import { layers, namedFlavor } from '@protomaps/basemaps'
const fonts = new Set()
const walk = (v) => {
  if (Array.isArray(v)) {
    if (v.every(x => typeof x === 'string')) { v.forEach(x => fonts.add(x)) }
    v.forEach(walk)
  }
}
for (const l of layers('protomaps-base', namedFlavor('$FLAVOR'), { lang: 'en' })) {
  if (l.layout && l.layout['text-font']) { walk(l.layout['text-font']) }
}
console.log([...fonts].filter(f => /Sans|Serif/.test(f)).sort().join('\n'))
")
if [ ${#FONTSTACKS[@]} -eq 0 ]; then
  echo "!! No fontstacks found — is @protomaps/basemaps installed?" >&2
  exit 1
fi
printf '    - %s\n' "${FONTSTACKS[@]}"

echo "==> Fetching protomaps/basemaps-assets @ $ASSETS_SHA"
git -C "$TMP" init -q
git -C "$TMP" remote add origin https://github.com/protomaps/basemaps-assets.git
git -C "$TMP" fetch -q --depth 1 origin "$ASSETS_SHA"
git -C "$TMP" checkout -q FETCH_HEAD

echo "==> Refreshing $DEST"
rm -rf "$DEST/fonts" "$DEST/sprites"
mkdir -p "$DEST/fonts" "$DEST/sprites/v4"
# Copy each fontstack into a hyphenated, space-free directory name. Spaces in
# the served path (e.g. "Noto%20Sans%20Regular") can fail to resolve on static
# hosts and fall through to the SPA fallback; the components rewrite the
# text-font names to match these directories.
for f in "${FONTSTACKS[@]}"; do
  cp -R "$TMP/fonts/$f" "$DEST/fonts/${f// /-}"
done
cp "$TMP/fonts/OFL.txt" "$DEST/fonts/OFL.txt"
cp "$TMP/sprites/v4/$FLAVOR.json" "$TMP/sprites/v4/$FLAVOR.png" \
   "$TMP/sprites/v4/$FLAVOR@2x.json" "$TMP/sprites/v4/$FLAVOR@2x.png" \
   "$DEST/sprites/v4/"

echo "==> Done. Vendored $(find "$DEST/fonts" -name '*.pbf' | wc -l | tr -d ' ') glyph files for ${#FONTSTACKS[@]} fontstack(s) + the $FLAVOR sprite."
