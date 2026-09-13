# Sync, and why we're not doing it yet

## v1: there is nothing to sync

One server owns the state. Clients hold a projection and a sequence number. A client that falls
behind replays from `?after=seq`. A client that is offline shows stale data and cannot write.

That is not a limitation to apologize for — it is correct for the actual use case, which is
clients on or near the machine where the work runs.

## When this stops being enough

Three triggers, none of which are v1:

1. **Offline editing.** Writing notes on a plane, syncing when you land.
2. **Multiplayer.** Two people on one board, dragging simultaneously.
3. **A genuinely hosted product.** Boards that exist without any daemon running.

## The answer when we get there: Yjs

Evaluated against Automerge, Loro, Electric SQL, Zero, PowerSync, and a hand-rolled event-log
with last-write-wins.

**Yjs** (`yjs` + `y-websocket` + `y-indexeddb`), ~30–40kb gzipped, pure JS. Pure JS matters more
than it sounds: the Node daemon and the browser run the *identical* library against the *same*
document, with no WASM/JS boundary or version mismatch between them. The daemon acts as the
y-websocket relay for local clients; a thin hosted relay serves remote ones.

Document shape:
```
Y.Map (board)
  └─ Y.Array<Y.Map> (columns)
       └─ Y.Array<Y.Map> (cards)   each with a fractional-index `pos`
            └─ Y.Text (note body)
```

**Cost:** we write the fractional-index move logic ourselves. Well-trodden, moderate effort —
and note that our v1 data model already uses fractional indices, so this is not new work, it is
work we've already done.

**What we're giving up:**
- *Loro* has native Movable List and Movable Tree — the only library that models kanban reorder
  without hand-rolled indexing. Costs ~320kb WASM and a much thinner ecosystem. If the move
  logic turns out genuinely painful, this is the trade to revisit.
- *Automerge* gives git-like history and branching, at ~100–150kb WASM.
- *Electric / Zero / PowerSync / Replicache* all assume a Postgres backend and a hosted sync
  service. None has a clean "embed inside a Node daemon" story; they are web-client-and-server
  frameworks first. Wrong shape for a local-first tool. Electric's write path is also mid-rewrite.

**Hand-rolled LWW** is fine for scalar fields and breaks exactly where kanban lives — concurrent
reorders of an ordered list. You end up rebuilding a list CRDT by hand. Don't.

## Addendum — sharing is not the same problem

Added September 2026, after thinking through the share button. See
[`11-going-multiplayer.md`](11-going-multiplayer.md).

Everything above is about **concurrent editing**: two people dragging the same board at the same
moment. That is what Yjs is for and the analysis stands.

Handoff is a different shape. I stop, you start — **sequential, not concurrent**. It needs the
event log replicated and folded, not a CRDT arbitrating simultaneous writes. Don't pull in 40kb
and a relay protocol to ship a share button; the append-only log plus the shared reducer we
already have is the substrate, and a git orphan branch or a tailnet peer is enough transport.

The decision below — *the local daemon is authoritative; the cloud is a relay, never a copy* —
is still the one that matters, and a hosted sharing tier is in tension with it. Resolvable (a
relay storing an encrypted log it cannot read is not a "copy" in the sense meant here), but it
has to be decided deliberately rather than drifted into.

## The decision that actually matters

Not which CRDT. It is **who is authoritative**.

We are choosing: **the local daemon is authoritative; the cloud is a relay, never a copy.** Your
boards and your code live on your machine. Remote access is a tunnel to your daemon, not a
sync to our database.

t3code's relay design is the proof this works well — their Cloudflare Worker brokers the
connection and mints credentials but never proxies session traffic, and never holds a session
token. That is the model to copy if and when we need remote access.

Reversing this later — going cloud-authoritative — is a rewrite. Deciding it now is free.
