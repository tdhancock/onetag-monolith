#!/usr/bin/env sh
# Fails if a raw hex colour appears outside the token layer.
#
# Roughly fifteen OneTag tickets carry an acceptance criterion of the form
# "grep for raw hex returns no matches". This turns that from a request into
# a gate.
#
# Deliberately scoped to paths that are clean. The pre-existing screens under
# app/ and components/native/ are full of inline hex and get cleaned up
# progressively by the M1c re-skin tickets — pointing this at them today would
# just fail every build. Widen the lists below as those tickets land.

set -eu

# Directories that are clean from birth, searched recursively.
DIRS="theme lib features components/native/ui"

# Shared components re-skinned onto the tokens (ONE-64 onward). Screens join
# in the M1c close-out ticket.
FILES="
components/native/Icons.tsx
components/native/UserAvatar.tsx
components/native/Toast.tsx
components/native/PostSkeleton.tsx
components/native/RenderUserContent.tsx
"

# theme/tokens.ts is the source of truth and must contain hex.
# An explicit "allow-hex" comment on the line opts out (e.g. the QR code, which
# is necessarily pure black on white for scan reliability).
EXCLUDE_FILE="theme/tokens.ts"

status=0

for path in $DIRS $FILES; do
  # A listed path that has gone missing is a stale list, not a clean one.
  if [ ! -e "$path" ]; then
    echo "check-no-raw-hex: $path is listed but does not exist."
    status=1
    continue
  fi

  # -H so a single file reports its name the same way a directory does.
  matches=$(
    grep -rniHE --include='*.ts' --include='*.tsx' \
      '#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?([^0-9a-z]|$)' "$path" 2>/dev/null \
      | grep -v "^${EXCLUDE_FILE}:" \
      | grep -v 'allow-hex' \
      || true
  )

  if [ -n "$matches" ]; then
    echo "Raw hex colours found in $path — use theme/tokens.ts instead:"
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
