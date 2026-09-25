#!/usr/bin/env sh
# Fails if a raw hex colour, or a class from the old dark skin, appears
# outside the token layer.
#
# Roughly fifteen OneTag tickets carry an acceptance criterion of the form
# "grep for raw hex returns no matches". This turns that from a request into
# a gate. Since M1c closed (ONE-77) it covers the whole app: every screen
# under app/ and every component, so the old skin cannot creep back one
# quick fix at a time. __tests__/scripts/noRawHexGate.test.ts pins the list
# so it cannot be narrowed quietly.
#
# Usage: sh scripts/check-no-raw-hex.sh [path ...]
#   With no arguments it checks DIRS below. Paths given on the command line
#   are checked instead, which is how the gate's own test proves it fails.

set -eu

# Searched recursively, .ts and .tsx only.
DIRS="theme lib features app components"

# theme/tokens.ts is the source of truth and must contain hex.
# An explicit "allow-hex" comment on the line opts out, with a stated reason
# (e.g. a QR code, which is necessarily pure black on white to scan).
EXCLUDE_FILE="theme/tokens.ts"

# Six-, three- or eight-digit hex, not followed by more word characters.
HEX_PATTERN='#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?([^0-9a-z]|$)'

# The old dark skin's NativeWind classes: black and grey grounds, white and
# grey text, the blue accent, the red error tints. The token classes
# (bg-bg, text-text, border-border, …) take their place.
CLASS_PATTERN='(^|[^A-Za-z0-9_-])(bg-(black|gray-[0-9]+|blue-[0-9]+|red-[0-9]+)|text-(white|gray-[0-9]+|blue-[0-9]+|red-[0-9]+)|border-(gray|blue|red)-[0-9]+)([^A-Za-z0-9_-]|$)'

if [ "$#" -gt 0 ]; then
  PATHS="$*"
else
  PATHS="$DIRS"
fi

status=0

# $1: path, $2: grep -E pattern, $3: extra grep flag ("-i" or ""), $4: what it found.
scan() {
  # -H so a single file reports its name the same way a directory does.
  matches=$(
    grep -rnHE $3 --include='*.ts' --include='*.tsx' "$2" "$1" 2>/dev/null \
      | grep -v "^${EXCLUDE_FILE}:" \
      | grep -v 'allow-hex' \
      || true
  )

  if [ -n "$matches" ]; then
    echo "$4 found in $1 — use theme/tokens.ts instead:"
    echo "$matches"
    echo ""
    status=1
  fi
}

for path in $PATHS; do
  # A listed path that has gone missing is a stale list, not a clean one.
  if [ ! -e "$path" ]; then
    echo "check-no-raw-hex: $path is listed but does not exist."
    status=1
    continue
  fi

  scan "$path" "$HEX_PATTERN" "-i" "Raw hex colours"
  scan "$path" "$CLASS_PATTERN" "" "Old-skin classes"
done

if [ "$status" -ne 0 ]; then
  echo "Add '// allow-hex' on a line only when a literal colour is genuinely required, and say why."
  exit 1
fi

echo "No raw hex or old-skin classes outside the token layer."
