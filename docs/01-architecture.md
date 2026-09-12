# Architecture

## Shape

One long-lived **server process** owns every piece of mutable state and every child process.
Clients render and send commands. No client ever touches the filesystem, spawns an agent, or
holds authoritative state.

```
┌─────────────────────────────────────────────────────────────┐
│ kandy server                                                │
│                                                             │
│  HTTP (commands)          SSE /events (stream)              │
│         │                        ▲                          │
│         ▼                        │                          │
│   ┌──────────┐   append    ┌───────────┐   derive  ┌──────┐ │
│   │ command  │ ──────────► │ event log │ ────────► │ view │ │
│   │ handler  │             │  (SQLite) │           │      │ │
│   └──────────┘             └───────────┘           └──────┘ │
│         │                        ▲                          │
│         ▼                        │ emits                    │
│   ┌──────────────┐        ┌──────────────┐                  │
│   │ worktree mgr │◄───────│ run manager  │                  │
│   │ (git)        │        │ (child procs)│                  │
│   └──────────────┘        └──────┬───────┘                  │
└───────────────────────────────────┼─────────────────────────┘
                                    │ spawn + parse JSONL
                      claude ─ codex ─ cursor-agent ─ opencode …
```

## Why this shape

**Because agents outlive clients.** A note kicked off from the TUI must keep running when you
close the terminal, and its progress must appear in a browser tab you open ten minutes later.
That requirement alone forces a daemon. Everything else follows from it.

**Because state must have exactly one owner.** The alternative — clients with local state that
reconcile — is a distributed systems problem we have no reason to sign up for. One writer, one
event log, monotonic sequence numbers, no vector clocks.

## Transport: HTTP + SSE

Commands are ordinary `POST`s. State changes stream back over a single multiplexed
`GET /events` SSE connection.

Not WebSocket. The traffic is overwhelmingly one-directional (server → client streams of agent
output); SSE reconnects automatically with `Last-Event-ID`, survives every proxy, and can be
debugged with `curl`. WebSocket would buy us bidirectionality we don't need and cost us
reconnect logic we'd have to write.

This is the same call opencode made — their event bus is `text/event-stream` with a 15s
heartbeat comment, and it holds up at their scale. t3code chose WebSocket RPC instead; their
traffic includes interactive PTY sessions, which is a genuine reason we don't currently have.

**Revisit if:** we add interactive terminal attach (a real PTY in the browser). Then a WS
channel alongside SSE is the right answer — not a replacement for it.

## Event sourcing, from day one

Every state change is an append to an immutable log. Views are projections. This is not
architecture astronomy; it is the cheapest way to get four things we need anyway:

- **Replay** — a client that reconnects asks for everything after seq N. No snapshot diffing.
- **History** — "what did this agent do" is a query, not a log file we forgot to write.
- **Audit** — agents take destructive actions. We want the tape.
- **Future multiplayer** — a single-writer ordered log is the substrate sync needs later.

opencode's own sync design doc is candid that bolting event sourcing on *after* the fact left
them maintaining two parallel event systems (`Bus` and `SyncEvent`) with a compatibility shim.
We are taking the lesson for free.

Storage is SQLite via Node 22's built-in `node:sqlite` — zero dependencies, one file at
`~/.local/state/kandy/kandy.db`.

## The protocol package is the source of truth

`packages/core` defines every command, every event, and every view type as a schema. The
server validates against it, clients are typed from it, and the HTTP surface is generated from
it. Nothing is hand-written twice.

Both opencode and t3code independently converged on this (`packages/protocol`,
`packages/contracts`) as their explicit anti-drift mechanism. It is the single highest-leverage
structural decision in a multi-client codebase.

## Local mode opens no port, by default

For the common case — one user, one machine — the server runs in-process with the client and
they talk over an in-memory channel rather than a socket. A real HTTP listener starts only when
the user asks for network exposure (`kandy serve --port`).

This eliminates port races, lockfiles, discovery files, and the entire class of "is the daemon
running and on which port" bugs, for the 90% case. It also means the default configuration has
no attack surface. opencode does exactly this with a ~60-line worker RPC shim, and it is the
cleanest idea in their codebase.

When a port *is* opened, it requires auth — a bearer token, never trust-by-locality.

## Isolation: one worktree per note

The load-bearing decision.

When a note starts running, the server creates a git worktree and a branch for it:

```
.kandy/worktrees/<note-id>/     ← the agent's cwd
branch: kandy/<note-id>-<slug>
```

The agent's child process is spawned with that worktree as its working directory. It cannot see
or touch any other note's work. Six notes can run against one repo with zero interference.

When the note finishes, the branch is the deliverable. Review is `git diff main...branch`.
Merge, discard, or send back — all three are cheap and none of them can corrupt the user's
actual working tree, which was never touched.

This is the thing that is hard to copy in a weekend, and it is why it is in the v1 scaffold
rather than the roadmap.

## Transcript is not the event log

What an agent says and does streams to clients over the same SSE connection, but
deliberately **carries no `id:` field**. Per the SSE spec that leaves the client's
`Last-Event-ID` untouched, so a reconnect resumes the domain log exactly where it left off
rather than replaying megabytes of agent chatter. Transcript lives in its own table, keyed
per-run, and is fetched only for the note actually open.

This is the concrete form of the rule in [`02-data-model.md`](02-data-model.md): board replay
must never be proportional to how talkative the agents were.

## Steering

A note is not fire-and-forget. A message sent to a note either:

1. **Reaches the live agent**, if its CLI accepts further user turns on stdin — Claude Code does,
   over `--input-format stream-json`; or
2. **Queues a follow-up run** that resumes the agent's session in the *same* worktree, so it
   keeps its context and its working state.

The caller is told which happened, because from the user's side the difference between "it heard
me" and "it will hear me next turn" is the entire feel of the thing.

## Agent adapters

Each supported agent is an adapter that knows three things: how to spawn it headlessly, how to
parse its output stream into our event types, and how to resume it.

```ts
interface AgentAdapter {
  id: string
  detect(): Promise<boolean>           // is it installed & authed?
  spawn(opts: SpawnOptions): AgentRun  // cwd = the note's worktree
  parse(line: string): AgentEvent[]    // its JSONL → our events
}
```

Every target CLI has a real headless mode with structured output:

| Agent | Headless invocation | Notes |
| --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --verbose` | `--verbose` is **required** or it won't actually stream |
| Codex | `codex exec --json` | session id only available from the stream; cannot be pre-assigned |
| Cursor | `cursor-agent -p --output-format stream-json` | |
| opencode | `opencode acp` (stdio ndjson) | cleanest target — a real protocol, not scraped stdout |
| Gemini | `gemini -o json` | session id not reliably surfaced for resume (upstream gap) |
| Grok Build | `grok -p --output-format streaming-json` | |

Credentials are never our problem: a spawned child inherits the user's existing CLI auth. We do
not read, store, or transmit tokens. See [`05-agent-auth.md`](05-agent-auth.md) for the policy
question this raises, which is real.

## Permissions

A wildcard rule gate — `allow` / `deny` / `ask` — evaluated as a pure function over
(action, target). On `ask`, the run blocks on a promise, the request is published as an event,
and any client can answer it. Unanswered requests are rejected on shutdown so nothing hangs.

This is a policy gate, not a sandbox. The worktree bounds blast radius within the repo; it does
not stop an agent from running `curl | sh`. Real sandboxing is a later, separate decision.

## What we are explicitly not doing

- **Effect-TS.** opencode and t3code both went deep on it. It buys correctness and costs a
  steep, permanent learning tax on every contributor. Plain TypeScript with small modules until
  we feel actual pain.
- **CRDTs in v1.** Single-writer server means no concurrent-edit problem to solve. Yjs is the
  answer *if and when* we do offline editing or multiplayer — see [`07-sync.md`](07-sync.md).
- **A cloud backend.** The remote-access story is a tunnel to your own daemon, not a hosted
  copy of your data. Building the cloud before the local product works is how this dies.
