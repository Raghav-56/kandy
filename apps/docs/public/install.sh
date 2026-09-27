#!/bin/sh
# Install kandy — https://hiteshbandhu.github.io/kandy/
#
#   curl -fsSL https://hiteshbandhu.github.io/kandy/install.sh | sh
#
# Checks for Node 22+, installs the newest release from GitHub with npm, then
# asks the first-run questions — only on a machine that hasn't answered them,
# so running this again just updates. Nothing here needs sudo.

set -eu

URL="${KANDY_TGZ:-https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz}"
DOCS="https://hiteshbandhu.github.io/kandy/guide/getting-started"

say() { printf '  %s\n' "$*"; }
fail() { printf '\n  \033[31m%s\033[0m\n' "$1" >&2; shift; for l in "$@"; do say "$l" >&2; done; echo >&2; exit 1; }

# Already here? Then this is an update, and says so.
OLD=""
if command -v kandy >/dev/null 2>&1; then OLD=$(kandy --version 2>/dev/null || true); fi

echo
if [ -n "$OLD" ]; then say "kandy $OLD is installed — updating to the newest release"; else say "installing kandy"; fi

command -v node >/dev/null 2>&1 || fail "kandy needs Node.js 22 or newer, and there's no node here." \
  "Get it from https://nodejs.org (or: brew install node, fnm, nvm), then run this again."
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 22 ] 2>/dev/null || fail "kandy needs Node.js 22 or newer; this is $(node -v)." \
  "Update it from https://nodejs.org (or your version manager), then run this again."
command -v npm >/dev/null 2>&1 || fail "npm is missing — it ships with Node.js; reinstall Node from https://nodejs.org."

# Stop a running kandy first, so the new version is what starts next.
if [ -n "$OLD" ]; then kandy stop >/dev/null 2>&1 || true; fi

if ! npm install -g --no-fund --no-audit --no-update-notifier --no-progress --loglevel=error "$URL"; then
  fail "npm couldn't install kandy." \
    "If that was a permissions error (EACCES), npm's global folder belongs to root." \
    "Fix it once: https://hiteshbandhu.github.io/kandy/guide/troubleshooting" \
    "— or use a version manager like fnm or nvm — then run this again."
fi

command -v kandy >/dev/null 2>&1 || fail "kandy installed, but it isn't on your PATH." \
  "npm put it in $(npm prefix -g)/bin — add that to PATH, then run: kandy"

NEW=$(kandy --version)
if [ -z "$OLD" ]; then say "kandy $NEW installed"
elif [ "$OLD" = "$NEW" ]; then say "kandy $NEW — already the newest"
else say "kandy updated: $OLD → $NEW"; fi

# The first-run questions need a keyboard. This script is being read from a
# pipe, so the terminal is reached directly; with none (CI, a script), skip.
if [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
  kandy setup --first-run </dev/tty
else
  echo
  say "next: run kandy inside a git repository — $DOCS"
fi
echo
