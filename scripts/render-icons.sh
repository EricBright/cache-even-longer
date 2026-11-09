#!/usr/bin/env sh
# Re-render the PNG icons from src/icons/icon.svg (requires ImageMagick 7).
set -eu

cd "$(dirname "$0")/.."

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (the 'magick' command was not found)." >&2
  exit 1
fi

# Add-on identity (also used by the options page and the add-ons manager)
magick -background none -density 384 src/icons/icon.svg -resize 96x96 -depth 8 -strip src/icons/icon-96.png
magick -background none -density 384 src/icons/icon.svg -resize 48x48 -depth 8 -strip src/icons/icon-48.png

# Simplified clock mark for the 16/32px toolbar button
magick -background none -density 384 src/icons/toolbar.svg -resize 32x32 -depth 8 -strip src/icons/icon-32.png
magick -background none -density 384 src/icons/toolbar.svg -resize 16x16 -depth 8 -strip src/icons/icon-16.png

echo "Rendered the 96/48 add-on icons and 32/16 toolbar icons"
