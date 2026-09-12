# Protocol

Defined once in `packages/core`. Server validates against it; clients are typed from it.

## HTTP

All command endpoints are `POST`, take a JSON body, and return `{ ok: true, seq }` — the
sequence number of the resulting event. A client that wants read-your-writes waits for that seq
to arrive on the event stream rather than optimistically merging a response body.

```
GET  /health                      → { version, uptime, pid }

GET  /boards                      → Board[]
POST /boards                      { name, repoPath }
GET  /boards/:id/view             → full board projection (initial load)

POST /notes                       { boardId, columnId, title, body }
POST /notes/:id/edit              { title?, body? }
POST /notes/:id/move              { columnId, pos }
POST /notes/:id/assign            { agent }
POST /notes/:id/delete

POST /notes/:id/run               { agent? }        → queue for execution
POST /runs/:id/cancel
POST /runs/:id/respond            { requestId, decision, comment? }
GET  /runs/:id/output             ?after=&limit=    → paginated transcript

POST /notes/:id/review            { decision, comment? }
GET  /notes/:id/diff              → unified diff vs base

GET  /agents                      → AgentInfo[]     { id, installed, authed, version }

GET  /events                      ?after=<seq>      → SSE stream
```

## SSE

A single multiplexed stream. One connection carries every board the client cares about.

```
id: 1482
event: note.moved
data: {"seq":1482,"ts":1757... ,"noteId":"note_01h9x","columnId":"col_run","pos":"a0h"}
```

- Reconnect with `Last-Event-ID`; the server replays from there. No snapshot refetch.
- 15s heartbeat comment (`:\n\n`) to keep intermediaries from closing idle connections.
- `run.output` events are batched — coalesced over a ~50ms window — because an agent emitting
  a thousand lines a second must not become a thousand DOM updates a second.

## Client state

```
1. GET /boards/:id/view   → snapshot + its seq
2. GET /events?after=seq  → stream
3. apply(event) reduces into the same shape the snapshot has
```

The reducer lives in `packages/core` and is shared by web and TUI. There is exactly one
implementation of "what does this event do to the board," and both clients use it.

## Errors

```json
{ "ok": false, "error": { "code": "note_not_found", "message": "...", "detail": {} } }
```

Codes are a closed union in `packages/core`. Clients switch on `code`, never on `message`.

## Auth

Local in-process mode: none — there is no socket to reach.

Networked mode (`kandy serve --port`): `Authorization: Bearer <token>`, token generated on
first run and stored at `~/.local/state/kandy/token` with mode `0600`. SSE cannot set headers
from `EventSource`, so the stream also accepts `?token=` — which means the token lands in
logs. Use `fetch`-based SSE parsing on clients that can, and treat the query param as a
fallback.

**Never trust locality.** A bound port is reachable by every process on the machine and, on a
misconfigured network, by more than that.
