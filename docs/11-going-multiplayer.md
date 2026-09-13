# Going multiplayer

Not a plan. A place to keep the thinking so it survives the conversation it came from.
Nothing here is committed to, and some of it contradicts decisions we already made —
that's noted where it happens.

## The bet

The moat isn't "orchestrate agents." It's a **share button**.

A teammate running their own kandy, on their own laptop, with their own agent logins, picks up
a note I started — same context, same transcript — and keeps going. Multiplayer AI.

Why this is the right bet and the accounting/stats angle isn't: Herdr's primitive is a terminal
pane. A pane is inherently one machine, one user, and it forgets when it closes. They can add a
board view in a sprint; they cannot make a pty shareable without changing what they are. This is
the one thing our architecture does naturally and theirs fights.

It also reframes worktree isolation: today it stops *my* agents colliding. Shared, it stops *a
team's* agents colliding — which nobody has a good answer for yet.

## Why we're closer than it looks

Three choices made for other reasons turn out to be the multiplayer choices:

- **Immutable append-only log.** The only data model where merging two people's histories is
  tractable at all. A mutable board state would have killed this outright.
- **One reducer, server and clients.** Two machines folding the same events land on the same
  view. That is the correctness property, and we already have it.
- **Base-62 fractional indexing.** *The* standard trick for concurrent insertion without a
  coordinator. Picked for ordering; happens to be what multiplayer needs.

## The fidelity cliff (the weak link in the pitch)

"Same context and transcript" has a seam in it. Claude Code resumes by session id, Codex by
thread id, and both are **local** — a session on my machine is not resumable on yours, and
Codex's thread lives in my `~/.codex`.

So a teammate cannot literally continue my agent's session. They start a fresh run seeded with
the replayed transcript as context. Usually that's fine — arguably better, since they get to
edit the framing — but it is a different thing, and on long runs people will feel it.

Decide the honest framing early: **"hand off the thread"**, not "resume the session." Marketing
the stronger claim and shipping the weaker one is how you lose trust on the one feature the
business rests on.

## Transport: three options, and a conflict to resolve

### Git remote (orphan branch)

Events as append-only JSONL on an orphan branch, one file per device so merges stay trivial,
fold on pull. Branches from agent runs push the same way they already do.

What it buys: no server, no auth system, no infra bill. GitHub already solved identity and
access control. A private repo means transcripts stay exactly as private as the code — which
sells to teams that would never let a startup host their agent transcripts, i.e. most teams
worth selling to.

### Tailnet peer sync

Two laptops on a tailnet replicate the log directly. No relay, no inbound ports, no hosted
service. This is the self-hosted enterprise story with ~zero infra on our side.

Composes with git rather than competing: **git for durable/async handoff, tailnet for live.**

### Cloud relay

The hosted tier. Note the property worth protecting: agents run on the developer's laptop with
their own logins, so our cloud stores and relays events and **never runs inference, never pays
for compute, never holds a provider key**. Per-seat revenue against near-zero marginal cost.
Don't trade that away later for a "run it in our cloud" feature — it sounds convenient and it
destroys the economics.

### The conflict

[`08-roadmap.md`](08-roadmap.md) explicitly defers *"any cloud storage of user content"*, and
[`07-sync.md`](07-sync.md) commits to *"the local daemon is authoritative; the cloud is a relay,
never a copy."* A hosted sharing tier is in tension with both.

It is resolvable — a relay that stores an encrypted event log it cannot read is still not a
"copy" in the sense 07 meant — but it has to be decided deliberately, not drifted into.
Reversing to cloud-authoritative later is a rewrite; 07 is right about that.

### Yjs vs the event log

07 picks Yjs for sync. That isn't wrong, it's a different layer: Yjs solves concurrent *editing*
of board structure. Handoff is **sequential, not concurrent** — I stop, you start — and does not
need a CRDT at all. Don't pull in 40kb and a relay protocol to ship a share button.

## Tailscale

t3code's decision, worth copying verbatim (`t3code/docs/internals/remote.md:60`):

> "Tailscale is not a separate target kind... Tailscale is an endpoint provider and transport,
> not a distinct runtime concept."

A Tailscale URL pairs through the ordinary bearer path. Their `packages/tailscale` is thin on
purpose: shells out to `tailscale status` / `tailscale serve`, classifies stderr into four
labels, and deliberately **drops the text**, because stderr can contain `tskey-…` auth keys.
Copy the posture — one endpoint provider behind an interface, invisible to the domain model.

**What Tailscale does not solve: sharing.** It is connectivity, not replication. A teammate
connecting over the tailnet to drive my agent on my box is *remote control*, not multiplayer —
the transcript still lives on one machine and dies with it. Tailscale + mobile gives us
t3code's feature, not our differentiator. Worth building; don't let it wear the moat's clothes.

**Aperture — right instinct, wrong layer.** Aperture is an AI gateway: identity-linked policy
over which models and tools an agent can reach, plus central audit. It does not express "who
can see this board." Don't build kandy's RBAC on it. Do treat it as an *integration*: an
enterprise already running Aperture gets kandy's agent traffic governed by the thing they
already bought. Same shape as inheriting git permissions — plug into their control plane
instead of shipping a second one. Only lands for Tailscale shops, so never the only path.

## Business shape

Hosted for teams, self-hosted for enterprise, open-ish core. Well-trodden (Sentry, GitLab,
PostHog). Two notes:

**Git-native sync eats half the enterprise tier, in the best way.** If the log rides on the
private repo, RBAC is largely answered — whoever can read the repo can read its board. *"We
inherit your existing GitHub/GitLab permissions; there is no second access-control system to
administer"* is a better enterprise answer than shipping our own, because it removes an admin
surface instead of adding one.

Which sharpens what enterprise actually buys: cross-repo and org-wide stats (the log-derived
accounting — what agents cost this quarter, what landed, what was discarded), audit trail, SSO,
seat management, SLA.

**The trap is sequencing.** RBAC, multi-tenancy, and SSO answer objections raised by named
buyers in live deals. Built speculatively, they're a year of work shaping the schema around
guesses. And enterprise self-hosting is a *sales motion*, not a product line — deployment docs,
upgrade paths, version support, someone answering Slack Connect at 11pm. That's a person.

Also: settle the open-core boundary before anyone contributes. Relicensing after the fact is how
projects burn goodwill, and Herdr being an open runtime means the comparison will get made.

## Mobile

t3code ships remote access and a mobile app; they also have a
`docs/operations/mobile-app-store-screenshots.md`, which tells you what you're signing up for —
review cycles, release trains, a second UI at parity forever. Real, just not cheap. Defer.

## Scratch space in kandy

Separate idea, worth keeping: **kandy should hold rough thoughts and documents, attachable as
context later.** A note is a job with a lifecycle; this is the opposite — something with no
status, that never runs, that exists to be pulled into a prompt.

This document is the proof of the need. It's a strategy conversation that had to be flattened
into a repo file to survive, and the next agent that needs it has to be told where it lives.

Open: is it a note type, a board-level drawer, or a first-class "context library" that notes
reference? Attachments in the steering chat already do a narrow version of this.

## What would actually validate any of it

One share, two laptops, over a git remote. No cloud, no auth, no tiers.

If two people hand a note back and forth for a week and it feels good, the only claim the
business rests on is proven. If it feels like friction, a year was saved. The pricing page
writes itself after that; it cannot be written before it.

**Half of this has now been tried.** [`12-spike-git-share.md`](12-spike-git-share.md) is the
orphan-branch transport built and pushed between two clones. The transport holds and is duller
than expected — there is no merge to get wrong. What does not hold is the review step: the
teammate receives a note asking for a verdict and cannot see the diff. Read it before costing
any of the above.
