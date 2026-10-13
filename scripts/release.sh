#!/bin/sh
# Build the release add-on and publish it as a GitHub release for package.json's version.
# Assets: MNInk-v<version>.mnaddon plus MNInk.mnaddon for releases/latest/download links.
set -eu
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
npm test
node scripts/build.mjs
if grep -q mninkdev dist/addon/main.js; then echo "dev channel in release build" >&2; exit 1; fi
cp "dist/MNInk-v$V.mnaddon" dist/MNInk.mnaddon
NOTES=$(awk -v v="## v$V" 'index($0, v) == 1 {f = 1; next} /^## /{f = 0} f' CHANGELOG.md)
gh release view "v$V" >/dev/null 2>&1 || gh release create "v$V" --title "MN Ink v$V" --notes "$NOTES"
gh release upload "v$V" --clobber "dist/MNInk-v$V.mnaddon" dist/MNInk.mnaddon
echo "released v$V"
