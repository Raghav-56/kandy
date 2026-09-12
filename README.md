# kandy

A board for orchestrating coding agents.

Sticky notes on a board are units of agent work. Write a note, assign it to an agent
(Claude Code, Codex, Cursor, opencode, Gemini, Grok), and it runs — isolated in its own
git worktree, streaming progress back to whichever client you happen to be looking at.
When it lands, the note carries a branch and a diff you can review without leaving the board.

**Why a board.** Every terminal agent today gives you one conversation. The real job is
"here are nine things, go" — and the two questions that matter are *what's in flight* and
*what's blocked on me*. A board answers both at a glance. A scrollback answers neither.

**Status:** pre-alpha. Architecture and scaffold only.

## Architecture

One background **server process** owns all state and all agent execution. Clients are thin
and interchangeable:

```
                    ┌──────────────────────────┐
   HTTP + SSE  ┌────┤  kandy server (daemon)   │
               │    │  SQLite event log        │
               │    │  worktree manager        │
               │    │  agent adapters ─┬─► claude
               │    └──────────────────┼─► codex
               │                       └─► cursor-agent …
   ┌───────────┴──────┬─────────────────┐
   │                  │                 │
 web (React)      tui (opentui)    desktop (later)
```

Read [`docs/01-architecture.md`](docs/01-architecture.md) for the real detail.

## Layout

| Path | What |
| --- | --- |
| `apps/server` | The daemon. Owns state, runs agents, serves the API. |
| `apps/web` | React board. The primary client. |
| `apps/tui` | Terminal client. Status + attach, not a full editor. |
| `packages/core` | Domain types, event schemas, protocol contract. Shared by everything. |
| `packages/client` | Typed client for the server API. Used by web and tui. |

## Development

```sh
pnpm install
pnpm dev
```

Requires Node >= 22 and pnpm.
