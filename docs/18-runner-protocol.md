# The runner protocol

How a machine that runs agents talks to a kandy hub. **Version 1.** The types are
[`packages/core/src/protocol.ts`](../packages/core/src/protocol.ts); this is the prose, and the
conformance test in `apps/server/test/protocol.test.ts` is the arbiter where the two disagree.

Published because a runner is where other people can add what kandy never will: a runner on a
CI box, in a sandbox, or for an agent we do not support. A kandy *frontend* ecosystem is a weaker
bet — kandy sits a layer above agents, and opencode's frontends exist because opencode *is* the
agent. The runner is the part worth opening.

## The rules

1. **The runner always dials out.** Nothing on a person's machine listens. No port, no tunnel, no
   firewall exception. The hub cannot reach in; it can only answer, and put commands on a stream
   the runner chose to open.
2. **The hub never spawns an agent, never holds a provider key, never touches a repository.**
   Everything that needs a checkout is a command to the runner that has it. A test asserts the
   hub's code cannot import anything that could.
3. **The hub stamps `seq` and `actor`.** The actor comes from the authenticated connection —
   the Tailscale login behind it — never from the message.
4. **A runner writes only about notes placed on it.** The hub places a note (`note.placed`, in
   the log) before it asks a runner to work on it; every later write is checked against that.
   `note.placed` itself can only come from the hub.

## Transport

HTTP and server-sent events. Not WebSocket: every kandy client already speaks both, they pass
unchanged through `tailscale serve` and ordinary proxies, and they need no dependency. Holding
the stream open is what "online" means, so there is no heartbeat protocol to get wrong.

```
runner                                            hub
  │  POST /runner/hello        Hello      ──────▶  │
  │  GET  /runner/stream?runner=…&after=N ◀─ SSE ─ │  events …, caught-up, events, command …
  │  POST /runner/log          LogBatch   ──────▶  │
  │  POST /runner/reply        Reply      ──────▶  │
  │  GET  /runs/:id/transcript            ◀──────  │  history, for briefing a handoff
```

Authentication is whatever the hub is configured for, applied to every request above: on one
machine, the daemon's bearer token; across a tailnet, nothing at all — Tailscale Serve's headers
say whose machine it is.

## 1. Hello

```json
POST /runner/hello
{ "protocol": 1, "runnerId": "run_m3…", "name": "alice-mbp", "os": "darwin",
  "agents": [AgentInfo, …], "boards": ["board_…"] }

→ { "ok": true, "protocol": 1, "owner": "alice@example.com" }
```

- `runnerId` is stable per machine: generated once and kept in the runner's state directory.
- `boards` are the boards whose repositories this machine has checked out. A runner is never
  asked to work on a repository it does not have; git decides who may clone what.
- `426` on a protocol mismatch — the runner is told to upgrade rather than left to misread
  commands. `403` if the id is already known under a different owner: a machine id is not a
  thing to be taken over by whoever presents it next.
- Sent again after every reconnect. The hub may have restarted.

## 2. The stream

```
GET /runner/stream?runner=<runnerId>&after=<seq>
```

In order:

1. **Every domain event after `after`**, replayed in full — paged on the hub, because a runner
   that joins a board with a long history must see all of it.
2. **`event: caught-up`**. Until this arrives the runner's replica is a board from the past, and
   it must not act on it.
3. **Live domain events**, as SSE `id:`/`event:`/`data:` frames, the same shape as `/events`.
   Transcript and activity frames are not sent: people watch those, and the runner wrote them.
4. **Commands**, interleaved:

```
event: command
data: { "id": "cmd_…", "op": "steer", "args": ["board_…", "note_…", "use pnpm"] }
```

A second stream from the same runner replaces the first. When a stream closes, every command
still waiting on that runner fails at once with `503` rather than timing out two minutes later.

## 3. The log

```json
POST /runner/log
{ "runnerId": "…", "ops": [
  { "op": "emit",     "pending": { "type": "run.started", "data": { … } } },
  { "op": "say",      "runId": "…", "role": "assistant", "text": "…" },
  { "op": "activity", "runId": "…", "tool": "bash", "detail": "pnpm test" },
  { "op": "output",   "runId": "…", "channel": "stderr", "text": "…" },
  { "op": "saveDiff", "noteId": "…", "snapshot": { "runId": "…", "branch": "…", "stat": "…", "diff": "…" } }
] }
```

- The five writes of the `Log` interface. The two reads are not here: a runner keeps its own
  replica for the board, and fetches transcripts over the ordinary route.
- **Batched, and ordered** within and across batches. A transcript out of order is a different
  transcript.
- **Checked whole before any of it is applied.** Half a batch is a transcript with a hole in it.
  Every op must be about a note placed on this runner; `403` otherwise.
- A failed post is retried with its batch at the front of the queue, so a hub that restarts
  mid-run loses and reorders nothing.

### Read-your-own-writes

A runner emits and then reads the board expecting to see what it emitted. It applies each emit
to its replica immediately and skips the echo when it streams back — matched in order, by
content, which works because the hub appends a runner's batches in the order sent and streams
them in the order appended.

## 4. Replies

```json
POST /runner/reply
{ "runnerId": "…", "id": "cmd_…", "ok": true,  "result": … }
{ "runnerId": "…", "id": "cmd_…", "ok": false, "error": "no such note", "status": 404 }
```

Exactly once per command. `status` is carried through to whoever asked the hub, so a missing
worktree on a laptop is still a `404` to the browser. A runner flushes its log before replying,
so a caller who acts on the reply sees what the command did. An unknown `op` is answered `501`,
not ignored.

## Commands

The `op`s are the methods of the runner's workshop — the interface in
`apps/server/src/workshop.ts`. Every argument and result is plain JSON. A runner that implements
a subset answers the rest with `501`, and the hub reports that as the reason rather than hanging.

## What is not in version 1

- **Consent.** A runner accepting work only from people its owner approves arrives with teams,
  in step 4 of the v1 plan. Until then a hub is single-owner.
- **Resumable streams by `Last-Event-ID`.** The runner reconnects with `after=` from its replica's
  head instead, which says the same thing without depending on a proxy to pass the header.
