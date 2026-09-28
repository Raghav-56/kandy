#!/bin/sh
# Install kandy — https://hiteshbandhu.github.io/kandy/
#
#   curl -fsSL https://hiteshbandhu.github.io/kandy/install.sh | sh
#
# Checks for Node 22.13+, installs the newest release from GitHub with npm,
# then asks the first-run questions — only on a machine that hasn't answered
# them, so running this again just updates. Nothing here needs sudo.
#
# Everything is inside main(), called on the last line: if the download is
# cut short, the shell reads an unfinished function and runs nothing.

set -eu

URL="${KANDY_TGZ:-https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz}"
DOCS="https://hiteshbandhu.github.io/kandy/guide/getting-started"
TROUBLE="https://hiteshbandhu.github.io/kandy/guide/troubleshooting"

say() { printf '  %s\n' "$*"; }
fail() { printf '\n  \033[31m%s\033[0m\n' "$1" >&2; shift; for l in "$@"; do say "$l" >&2; done; echo >&2; exit 1; }

# Stop this machine's kandy and team runner, so the new version is what
# starts next. Asked of the daemon itself (its /health says its pid) and of
# the runner's pid file, not of the old kandy's commands: `kandy stop` only
# exists from 0.2.0-alpha.2, and an older kandy took "stop" for a note to run.
# Prints how many it stopped.
# shellcheck disable=SC2016 # JavaScript, for node -e: the backticks are its strings.
STOP_JS='
const os = require(`os`), fs = require(`fs`), path = require(`path`)
const base = (v, f) => (v && path.isAbsolute(v) ? v : path.join(os.homedir(), f))
const state = path.join(base(process.env.XDG_STATE_HOME, `.local/state`), `kandy`)
const alive = (p) => { try { process.kill(p, 0); return true } catch { return false } }
const pids = []
;(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:4477/health`, { signal: AbortSignal.timeout(1500) })
    const b = await r.json()
    if (typeof b.pid === `number`) pids.push(b.pid)
  } catch {}
  try {
    const p = Number(fs.readFileSync(path.join(state, `runner.pid`), `utf8`).trim())
    if (p > 0 && alive(p)) pids.push(p)
  } catch {}
  for (const p of pids) { try { process.kill(p, `SIGTERM`) } catch {} }
  for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 250))
  process.stdout.write(String(pids.length))
})()
'

main() {
  if [ "$(id -u 2>/dev/null || echo 1)" = 0 ] && [ -z "${KANDY_ALLOW_ROOT:-}" ]; then
    fail "Don't run this as root or with sudo." \
      "kandy keeps its board in your home folder, and runs agents as you." \
      "Run it again without sudo. If npm then says EACCES: $TROUBLE" \
      "(In a container where root is the only user: KANDY_ALLOW_ROOT=1.)"
  fi

  # Already here? Then this is an update, and says so.
  OLD=""
  if command -v kandy >/dev/null 2>&1; then OLD=$(kandy --version 2>/dev/null || true); fi

  echo
  if [ -n "$OLD" ]; then say "kandy $OLD is installed — updating to the newest release"; else say "installing kandy"; fi

  command -v node >/dev/null 2>&1 || fail "kandy needs Node.js 22.13 or newer, and there's no node here." \
    "Get it from https://nodejs.org (or: brew install node, fnm, nvm), then run this again."
  NODE_V=$(node -p 'process.versions.node' 2>/dev/null || true)
  NODE_MAJOR=${NODE_V%%.*}
  NODE_REST=${NODE_V#*.}
  NODE_MINOR=${NODE_REST%%.*}
  if ! { [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 13 ]; }; } 2>/dev/null; then
    fail "kandy needs Node.js 22.13 or newer; this is Node ${NODE_V:-(unknown)}." \
      "Update it from https://nodejs.org (or: nvm install 22, fnm install 22), then run this again."
  fi
  command -v npm >/dev/null 2>&1 || fail "npm is missing — it ships with Node.js; reinstall Node from https://nodejs.org."

  STOPPED=$(node -e "$STOP_JS" 2>/dev/null || echo 0)
  if [ "${STOPPED:-0}" != 0 ]; then
    say "stopped the running kandy — notes it was running show as interrupted; Resume carries on"
  fi

  if ! npm install -g --no-fund --no-audit --no-update-notifier --no-progress --loglevel=error "$URL"; then
    fail "npm couldn't install kandy." \
      "If that was a permissions error (EACCES), npm's global folder belongs to root." \
      "Fix it once: $TROUBLE" \
      "— or use a version manager like fnm or nvm — then run this again."
  fi

  command -v kandy >/dev/null 2>&1 || fail "kandy installed, but it isn't on your PATH." \
    "npm put it in $(npm prefix -g 2>/dev/null || echo "npm's global folder")/bin — add that to PATH, then run: kandy"

  NEW=$(kandy --version 2>/dev/null || true)
  [ -n "$NEW" ] || fail "kandy installed, but running it failed." \
    "Run kandy --version to see why, or see $TROUBLE"
  if [ -z "$OLD" ]; then say "kandy $NEW installed"
  elif [ "$OLD" = "$NEW" ]; then say "kandy $NEW — already the newest"
  else say "kandy updated: $OLD → $NEW"; fi

  # The first-run questions need a keyboard. This script is being read from a
  # pipe, so the terminal is reached directly; with none (CI, a script), skip.
  if [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
    kandy setup --first-run </dev/tty || true
  else
    echo
    say "next: run kandy inside a git repository — $DOCS"
  fi
  echo
}

main "$@"
