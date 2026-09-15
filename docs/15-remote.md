# Remote access and sharing

The decision, and the order to build it in. Companion to
[`07-sync.md`](07-sync.md) (who is authoritative), [`11-going-multiplayer.md`](11-going-multiplayer.md)
(why sharing is the bet) and [`12-spike-git-share.md`](12-spike-git-share.md) (the transport,
already built).

## Two problems, one word

**Remote control** is you, on your phone, watching your own daemon. One identity. Connectivity,
not replication — the transcript still lives on one machine and dies with it. 11 is right that
this is t3code's feature and not the moat; build it anyway, it is cheap and genuinely useful.

**Handoff** is a teammate continuing a note on *their* machine with *their* agent logins. That
is replication, and it is the thing nobody else can do. Keep the honest framing 11 settled on:
**hand off the thread, not resume the session.**

They share exactly one thing — the daemon has to stop being open — and nothing else. Designing
them as one feature is how both get worse.

## Decision: Tailscale, local executor

The user's laptop stays the executor. Tailscale Serve for the owner's own devices, Tailscale
Funnel for guest links, the git orphan branch for true handoff.

**Not cloud sandboxes**, which is where Cursor and Codex went. It inverts the economics: we
would clone the repo into a VM we pay for and hold provider keys, when today agents run on the
developer's laptop under their own Max and ChatGPT subscriptions and kandy never runs inference.
It also forfeits the local transcript — both of those products hand off through a branch or a
patch, having lost the conversation. Claude Code's own Remote Control independently chose the
shape 07 already committed to: local executor, outbound only, a relay that routes messages and
never becomes the source of truth.

Fallback for someone who will not run Tailscale: Cloudflare Tunnel + Access one-time PIN (needs
a domain; Cloudflare sees plaintext; their quick tunnels do not support SSE at all). Escape
hatch: a ~300-line WebSocket relay on Fly, about $2/month, which is also the signalling server
if WebRTC ever matters.

### What Tailscale actually gives, and does not

- **No Node embedding.** `tsnet` is Go-only and there is no Node binding. kandy shells out to
  the `tailscale` CLI the user already has — t3code's conclusion verbatim: *"an endpoint
  provider and transport, not a distinct runtime concept."* Parse `tailscale status --json`;
  never surface stderr, which can contain `tskey-…` auth keys.
- **Serve carries identity, Funnel does not.** Serve injects `Tailscale-User-Login` into the
  proxied request, so owner auth is free. Funnel traffic is anonymous by design, so a guest link
  must carry a grant kandy mints and checks itself.
- **Funnel is limited to ports 443, 8443 and 10000**, and a port cannot be both. Serve takes
  443, Funnel takes 8443 — which conveniently means the daemon can tell an owner request from a
  guest request by the socket it arrived on, without trusting a header.
- **Bandwidth is undisclosed** — "it's a funnel, not a hose". Fine for text and diffs. Measure
  before promising anything larger.
- TLS terminates on the device, so the relay cannot read the traffic. Personal plan covers six
  users and unlimited devices at $0, and Funnel is on every plan.

## Phase 0 — close the daemon

Required by every option, and worth doing on its own. Measured against the running daemon rather
than read off the source:

| Request, no `Authorization` | Result |
| --- | --- |
| `GET /boards` | 200 — every board and repo path |
| `GET /events` | 200 — the entire live SSE transcript stream |
| `GET /repo/browse` | 200 — the home directory and all 29 repos, by name |
| `POST /notes` | 401 |
| `GET /boards` with `Host: laptop.tailnet.ts.net` | 403 |

Writes check the bearer. **Reads check nothing.** What stands between an unauthenticated caller
and every transcript is that the socket is on loopback and the Host header must say `localhost`
— and that same allowlist would 403 our own tunnel. Both change together:

1. Reads require a credential once the request did not arrive on loopback.
2. A `grants` table — scope, role, expiry, revoked-at, last-used — beside the existing
   `shared` table.
3. The Host allowlist becomes configuration rather than a constant.
4. One enforcement point, default deny.

## The grant model

Live Share is the closest published precedent, because their risk is ours — a guest who reaches
a terminal runs commands on the host's machine. Copy their posture: *"Only hosts can start
shared terminals"*, auto-shared terminals default to **read-only**, the host is notified the
instant a guest joins with a Remove button in the notification, and a repo can declare files a
guest may never open.

| Grant | Reads | Writes | Never |
| --- | --- | --- | --- |
| `watch` (default) | `/boards/:id/view`, `/runs/:id/transcript`, `/notes/:id/diff` | — | everything else |
| `steer` (explicit) | + `/runs/:id/output` | `/notes/:id/message`, `/runs/:id/cancel` | `/runs/:id/permission` |
| `owner` (Serve) | all | all | — |

Never shareable under any grant: `/repo/browse` and `/repo/check`, which enumerate the
filesystem; board create and remove; `/boards/:id/policy`; and approving an agent's shell
command.

**`POST /runs/:id/permission` is the line.** It is how an agent's request to run a command gets
approved, so a guest holding it has a shell on your laptop laundered through an agent. Even
`steer` does not get it: a guest can ask the agent to do something, and the host still approves
what it runs. That one rule is the difference between a share button and a remote code execution
feature.

## What opencode got wrong, and what it costs us to avoid

`/share` uploads the whole session — every message and tool call, including whatever `read` and
`bash` returned — with no confirmation in the code path. The read URL carries no secret; their
docs say shared conversations are publicly accessible to anyone with the link. The write secret
lives only in local sqlite and is cascade-deleted with the session, which produced the obvious
bug report: a user shared by accident, `unshare` failed, they deleted the session, and the share
stayed online with no way to remove it.

So: a share is an explicit act with a confirmation naming what becomes visible; the secret is in
the read path; and revocation lives with the grant, not the note, so deleting a note locally
cannot strand a live link.

Related, already ours to decide (12): a note's prompt goes onto the shared branch in plaintext
and stays there. `note.deleted` removes it from the board while `note.created` keeps the body on
the branch forever. **"Delete" will not mean what a user assumes it means.**

## Order

0. **Close the daemon.** Ships alone.
1. **Your phone.** `kandy remote on` → `tailscale serve`, a URL and a QR. Surface *"laptop
   asleep"* honestly — a closed lid stops the agents too, and no tunnel fixes that.
2. **A link for one note.** Funnel on 8443, grant scoped to one note, read-only, expiring, with
   the watcher visible on the note and a Revoke beside them. A guest view that is its own
   surface, not the full UI with buttons hidden.
3. **Steering with a leash.** Upgrade a live grant; guest messages attributed in the transcript;
   host can drop to read-only mid-run; permission approval stays local.
4. **True handoff.** `share.ts` exists. The blocking work is 12's own list, in its order — push
   the note's branch with the log so the reviewer can see the diff, chunk by month, refuse a
   backwards fetch, replace the root-commit board key, and settle sequential-only or add a
   Lamport clock.

## Not doing

- **Teams, RBAC, SSO.** If the log rides on the private repo, whoever can read the repo can read
  its board. Inheriting GitHub's permissions removes an admin surface instead of adding one.
  Build RBAC when a named buyer asks in a live deal.
- **A central server for v1.** The relay stays an escape hatch. If one is ever hosted it stores
  an encrypted log it cannot read, which is still not a "copy" in 07's sense. Going
  cloud-authoritative later is a rewrite.
- **A mobile app.** A second UI at parity forever. The web UI on a phone is all of Phase 1.
- **Yjs.** It solves concurrent editing; handoff is sequential.

## Open

- **Does the transcript cross the wire?** 11 promises "same context, same transcript", and 12's
  size analysis deliberately excluded transcripts, which are orders of magnitude larger than
  domain events. Those numbers describe the version that does not deliver the pitch. Size the
  real one before costing Phase 4.
- **Funnel's ceiling**, which is undisclosed.
- **Whether Funnel marks its own requests** with a header. Unverified, so tell owner from guest
  by which port the request arrived on until it is.
