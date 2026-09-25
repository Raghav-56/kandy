#!/usr/bin/env bash
#
# Start a kandy hub on your tailnet, in Docker, to try the team setup for real.
#
#   deploy/try-hub.sh                      (prints a login link to approve)
#   TS_AUTHKEY=tskey-auth-… deploy/try-hub.sh
#
# The hub runs in a container with its own Tailscale sidecar, so it is a
# separate machine on your tailnet — reached over HTTPS at
# https://kandy-hub.<your-tailnet>.ts.net, knowing people by their Tailscale
# login. Your laptop then joins it like anyone's would: kandy join <that url>.
#
# Stop it:          docker compose down
# Wipe it (board):  docker compose down -v
# The kandy-hub machine also appears in your Tailscale admin console; remove
# it there when you are done.

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '  %s\n' "$*"; }
fail() { printf '\n  \033[38;5;211m%s\033[0m\n\n' "$*"; exit 1; }

command -v docker >/dev/null || fail "Docker is not installed."
command -v tailscale >/dev/null || fail "Tailscale is not installed on this machine — https://tailscale.com/download"

status="$(tailscale status --json 2>/dev/null || echo '{}')"
field() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1') or '')" <<<"$status"; }

[ "$(field BackendState)" = "Running" ] ||
  fail "Tailscale is not running here. Open the Tailscale app and sign in (or run: tailscale up)."

suffix="$(field MagicDNSSuffix)"
[ -n "$suffix" ] ||
  fail "MagicDNS is off for your tailnet. Turn it on: https://login.tailscale.com/admin/dns"

# HTTPS certificates are what give the hub its https://…ts.net address.
python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('Self') or {}; sys.exit(0 if (d.get('CertDomains') or s.get('CertDomains')) else 1)" <<<"$status" ||
  fail "HTTPS certificates are off for your tailnet, and the hub's https address needs them.
  Turn them on: https://login.tailscale.com/admin/dns  (the HTTPS section)"

# No auth key is fine: the sidecar prints a one-time login link, and the
# hub joins as whoever opens it. Nothing to revoke afterwards.
export TS_AUTHKEY="${TS_AUTHKEY:-}"
export KANDY_TAILNET_HOST="kandy-hub.${suffix}"
url="https://${KANDY_TAILNET_HOST}"

say "tailnet  ${suffix}"
say "hub      ${url}"
say "starting the hub and its Tailscale sidecar…"
docker compose up -d --build >/dev/null

if [ -z "${TS_AUTHKEY}" ]; then
  # Wait for the sidecar to ask for a login, and hand the link over.
  link=""
  for _ in $(seq 1 30); do
    link="$(docker compose logs tailscale 2>/dev/null | grep -Eo 'https://login\.tailscale\.com/a/[A-Za-z0-9]+' | tail -1 || true)"
    [ -n "$link" ] && break
    # Already logged in from a previous run: no link will come.
    docker compose exec -T tailscale tailscale status --json 2>/dev/null | grep -q '"BackendState": "Running"' && break
    sleep 2
  done
  if [ -n "$link" ]; then
    echo
    say "Approve the hub on your tailnet — open this, signed in as you:"
    say "  $link"
    echo
  fi
fi

# The first HTTPS request makes Tailscale fetch a certificate, which can take
# a little while; a tailnet without HTTPS certificates never answers at all.
for _ in $(seq 1 100); do
  if curl -sf --max-time 5 "${url}/health" >/dev/null 2>&1; then
    printf '\n  \033[38;5;115mThe hub is up.\033[0m\n\n'
    say "1  open ${url}  — the first person to open it owns it"
    say "2  connect this machine:  kandy join ${url}"
    say "3  add people on the Team page, or: kandy invite <email>"
    echo
    exit 0
  fi
  sleep 3
done

echo
say "The hub has not answered at ${url} yet. The usual reasons:"
say "  · HTTPS certificates are off for your tailnet — https://login.tailscale.com/admin/dns"
say "  · the sidecar is still joining: docker compose logs tailscale"
say "  · the hub itself failed: docker compose logs hub"
exit 1
