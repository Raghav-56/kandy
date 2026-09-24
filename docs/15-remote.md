# Remote, and the hub/runner split

The decision, and the order to build it in. Companion to [`07-sync.md`](07-sync.md) (who is
authoritative), [`11-going-multiplayer.md`](11-going-multiplayer.md) (why sharing is the bet),
[`12-spike-git-share.md`](12-spike-git-share.md) (a transport, already built) and
[`16-threads.md`](16-threads.md) (what actually moves between people).

**Revised September 2026.** An earlier draft of this document centred on guest links into the
author's own daemon — a teammate opening a URL and steering an agent on *my* laptop. That was
wrong, and the reason is worth keeping: it means renting out my machine and paying for someone
else's tokens. The rule is now explicit.

> **Everyone works on their own machine, with their own resources and their own agent logins.**
> Nothing in kandy may be built in a way that makes one person's laptop another person's
> compute.

## The constraint that forces the architecture

If a company installs today's `kandy serve` on a server, that server is the thing that spawns
agents. It would run everyone's work under pooled credentials, which violates the rule above
outright. So the daemon has to come apart, and this is not a refinement — it is the whole design:

**Hub.** The event log, boards, identity, relay. Installable by a company on a VPS, runnable on
localhost for one person, hostable by us for people who want to run nothing. It **never spawns
an agent, never holds a provider key, and never needs the repository.** Events and transcripts,
nothing else.

**Runner.** On each person's laptop. Dials *out* to the hub — no inbound ports, no tunnel, no
firewall exception — claims the notes assigned to it, runs agents under that person's own
logins, and streams frames back.

This is the shape CI runners already have (GitHub self-hosted runners, Buildkite agents), and
kandy is most of the way there: `Engine` plus the event log is the hub, `Runner` is the runner,
and they already communicate through events rather than function calls. What is missing is a
network between them and the idea that a note belongs to a particular runner.

### The bonus: a hub gives a total order

[`12-spike-git-share.md`](12-spike-git-share.md) hit a wall it is blunt about — no total order
across devices, so two laptops that renamed the same note ended up permanently showing each
other's titles. *Stable disagreement*, not eventual consistency. Its own recommendation was to
choose between enforcing sequential-only handoff and adding a Lamport clock.

A hub is a single writer. It stamps the sequence, and the whole problem evaporates: no Lamport
clock, no CRDT, no Yjs, and `docs/07`'s sync analysis becomes moot rather than wrong. **The hub
design is strictly easier to make correct than the peer-to-peer one already in the repo.**

The git orphan branch does not die, though. It remains the right transport for the async case —
a teammate who was offline for a month, or two people with no shared hub — and it is already
built. Two transports, one log.

## Transport between runner and hub

Because the runner dials out, most of the transport question dissolves: a WebSocket to a hub the
company already exposes needs no NAT traversal and no tunnel. Tailscale stays relevant for two
narrower jobs — reaching your *own* daemon from your *own* phone, and letting a small team run a
hub on a tailnet without exposing it to the internet at all.

Verified, September 2026, against primary docs:

- **Tailscale cannot be embedded in a Node daemon.** `tsnet` is Go-only with no Node binding, so
  kandy shells out to the `tailscale` CLI the user already has — t3code's conclusion verbatim:
  *"an endpoint provider and transport, not a distinct runtime concept."* Parse
  `tailscale status --json`; never surface stderr, which can contain `tskey-…` auth keys.
- **Serve carries identity, Funnel does not.** Serve injects `Tailscale-User-Login`; Funnel
  traffic is anonymous by design. Funnel is limited to ports 443, 8443 and 10000, and a port
  cannot be both — so Serve on 443 and Funnel on 8443 lets the daemon tell an owner request from
  an anonymous one by the socket it arrived on, without trusting a header.
- Fallback for a hub that must be public without a tailnet: Cloudflare Tunnel + Access one-time
  PIN. Needs a domain; Cloudflare sees plaintext; their quick tunnels do not support SSE at all.
- Dead ends: ngrok free (20k requests a month, interstitial page), any embedded-Tailscale route
  from Node, WebRTC as a primary transport (it needs a relay anyway).

## Phase 0 — close the daemon

Required whichever way the rest goes, and worth doing alone. Measured against the running
process rather than read off the source.

**Before.** Writes checked the bearer; **reads checked nothing**:

| Request, no `Authorization` | Result |
| --- | --- |
| `GET /boards` | 200 — every board and repo path |
| `GET /events` | 200 — the entire live SSE transcript stream |
| `GET /repo/browse` | 200 — the home directory and all 29 repos, by name |
| `POST /notes` | 401 |
| `GET /boards` with `Host: laptop.tailnet.ts.net` | 403 |

All that stood between an unauthenticated caller and every transcript was the socket being on
loopback and the Host header having to say `localhost` — and that same allowlist would 403 our
own hub connection. So the two had to change together, and did:

**Done.** One gate in `http.ts`, ahead of all routing, default deny:

1. ✅ **Reads require a credential once the request did not come from this machine.** `GET /boards`,
   `/events`, `/repo/browse` and `/agents` now 401 with `WWW-Authenticate: Bearer` from any peer
   that is not this machine. On loopback nothing changed — that is the single-player daemon, and
   the token is handed to any same-origin fetch there anyway, so demanding it back is ceremony.
2. ✅ **`/auth/token` never leaves the machine**, whatever else the request gets right. It is the
   credential itself, so no token can buy it.
3. ✅ **The Host allowlist is configuration**, `KANDY_HOSTS=hub.example.com`, with or without a
   port. Verified: that Host answers 200, `evil.example` still 403s. It defeats DNS rebinding as
   before; what it has stopped doing is deciding, as a side effect, that remote is impossible.
4. ✅ **The bundle stays open**, but only files that really exist in the build. `serveStatic`
   could not be asked — its index.html fallback answers yes to everything by design, which would
   have reopened every API path it has never heard of. `isBundleAsset` is the narrow question.
5. ✅ **"From this machine" is not a question the socket can answer.** A reverse proxy dials the
   backend from the backend's own host, so with `tailscale serve` in front, every request on the
   tailnet arrives from `127.0.0.1` — the entire tailnet reading every transcript, through the
   gate rather than around it. Tailscale's identity headers do not rescue it either: [they are
   populated for users and not for tagged devices](https://tailscale.com/docs/concepts/tailscale-identity),
   so a tagged node is indistinguishable from localhost by header as well. What does survive a
   proxy is the name the caller asked for, so **both must agree** — the peer is this machine and
   it was addressed as this machine. A request that arrived as `laptop.tailnet.ts.net` is remote,
   however local its socket looks. This is the same mistake [others have shipped and had
   reported](https://github.com/projectmushroom/gravedecay/issues/149).

Two things deliberately left:

- **A `grants` table** — scope, role, expiry, revoked-at, last-used — beside the existing
  `shared`. Nothing yet issues a credential that is not the daemon token, so there is nothing to
  scope. It arrives with step 3 below.
- **SSE off-machine.** A browser's `EventSource` cannot set a header, so a remote board will need
  the token in a cookie or the query string. Not built, because there is no remote board to need
  it: the daemon still binds `127.0.0.1` only, confirmed with `lsof`. A deep link into a
  client-side route is 401 from off-machine for the same reason — making it work would mean
  making it indistinguishable from `GET /boards`, which is the thing being protected.

## What a hub may never do

Even a hub the company runs is a machine other people administer, so the boundary is worth
stating as a rule rather than an implementation detail.

| Never on the hub | Why |
| --- | --- |
| Spawn an agent | Violates the rule at the top; pools credentials |
| Hold a provider key | kandy has never held one and the economics depend on it |
| Clone the repository | Code stays in git, where permissions already exist |
| Approve a shell command | `POST /runs/:id/permission` is how an agent gets to run something. It belongs to the machine that will run it, always |

That last row is the one that turns a coordination server into a remote execution service if it
is ever relaxed. It is also why the guest-link model was wrong: it moved that decision onto a
link.

## Identity and permissions

Cheapest correct answer first: **inherit git**. If a board is tied to a repository and the log
rides alongside it, whoever can read the repo can read the board — no second access-control
system to administer, which is a better enterprise story than shipping one. A self-hosted hub
can start with exactly this and nothing else.

Build real RBAC when a named buyer asks for it in a live deal, not speculatively. `docs/11` is
right that building it on guesses shapes the schema around a year of imagined requirements.

## What opencode got wrong, and what it costs us to avoid

Their `/share` uploads the whole session — every message and tool call, including whatever
`read` and `bash` returned — with no confirmation in the code path. The read URL carries no
secret; their own docs say shared conversations are publicly accessible to anyone with the link.
The write secret that lets you take it down lives only in local sqlite and is cascade-deleted
with the session, which produced the predictable report: a user shared by accident, `unshare`
failed, they deleted the session, and the share stayed online with no way to remove it.

So, as rules: a share is an explicit act with a confirmation naming what becomes visible; the
secret is in the read path; revocation lives with the grant rather than the note, so deleting a
note locally cannot strand a live link.

Ours already, from [`12`](12-spike-git-share.md): a note's prompt goes onto the shared branch in
plaintext and stays there. `note.deleted` removes it from the board while `note.created` keeps
the body on the branch forever. **"Delete" will not mean what a user assumes it means.**

## Order

1. ✅ **The translation layer**, single-player — [`16-threads.md`](16-threads.md). Continue a note
   with a different agent on one machine. The hard part, testable today, useful alone.
2. ✅ **Close the daemon** — phase 0 above. Shipped by itself, as intended.
3. **Split hub from runner.** The runner dials out and claims notes; the hub stops spawning
   anything. Localhost first, so the split is proven before a network is added.
4. **Hand a note to another person's runner.** The thread from step 1 crossing the boundary from
   step 3, with the branch pushed alongside so the receiver can see the diff — the one step
   [`12`](12-spike-git-share.md) found does not survive the trip.
5. **Remote control of your own daemon** from your own phone. Deliberately last: it is a
   convenience, not the product, and `docs/11` is right that it is the feature t3code already
   has.

## Not doing

- **Cloud sandboxes.** Cursor and Codex both went this way: clone the repo into a VM they pay
  for, and hand off through a branch or a patch, having lost the conversation. It inverts our
  economics — agents run on the developer's laptop under their own subscriptions, so kandy never
  runs inference and never holds a provider key.
- **A mobile app.** A second UI at parity forever. The web UI on a phone is the whole of step 5.
- **Yjs.** It solves concurrent editing. With a hub stamping the order there is nothing left for
  it to solve.
- **Teams, RBAC, SSO** before a buyer asks. See above.
