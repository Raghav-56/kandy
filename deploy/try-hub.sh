#!/usr/bin/env bash
#
# Start a kandy hub on your tailnet, in Docker, to try the team setup for real.
#
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

[ -n "${TS_AUTHKEY:-}" ] ||
  fail "Needs an auth key so the container can join your tailnet.
  Make one at https://login.tailscale.com/admin/settings/keys (reusable is fine), then:
    TS_AUTHKEY=tskey-auth-… deploy/try-hub.sh"

export TS_AUTHKEY
export KANDY_TAILNET_HOST="kandy-hub.${suffix}"
url="https://${KANDY_TAILNET_HOST}"

say "tailnet  ${suffix}"
say "hub      ${url}"
say "starting the hub and its Tailscale sidecar…"
docker compose up -d --build >/dev/null

# The first HTTPS request makes Tailscale fetch a certificate, which can take
# a little while; a tailnet without HTTPS certificates never answers at all.
for _ in $(seq 1 60); do
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
