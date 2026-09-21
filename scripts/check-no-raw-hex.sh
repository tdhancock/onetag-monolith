#!/usr/bin/env sh
# Fails if a raw hex colour appears outside the token layer.
#
# Roughly fifteen OneTag tickets carry an acceptance criterion of the form
# "grep for raw hex returns no matches". This turns that from a request into
# a gate.
#
# Deliberately scoped to directories that are clean from birth. The pre-existing
# screens under app/ and components/native/ are full of inline hex and get
# cleaned up progressively by the M1c re-skin tickets — pointing this at them
# today would just fail every build. Widen DIRS as those tickets land.

set -eu

DIRS="theme lib features components/native/ui"

# theme/tokens.ts is the source of truth and must contain hex.
# An explicit "allow-hex" comment on the line opts out (e.g. the QR code, which
# is necessarily pure black on white for scan reliability).
EXCLUDE_FILE="theme/tokens.ts"

status=0

for dir in $DIRS; do
  [ -d "$dir" ] || continue

  matches=$(
    grep -rniE --include='*.ts' --include='*.tsx' \
      '#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?([^0-9a-z]|$)' "$dir" 2>/dev/null \
      | grep -v "^${EXCLUDE_FILE}:" \
      | grep -v 'allow-hex' \
      || true
  )

  if [ -n "$matches" ]; then
    echo "Raw hex colours found in $dir — use theme/tokens.ts instead:"
    echo "$matches"
    echo ""
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "Add '// allow-hex' on a line only when a literal colour is genuinely required."
  exit 1
fi

echo "No raw hex outside the token layer."
