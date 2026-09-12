# Landscape

Researched September 2026 by reading source, not marketing pages.

## t3code — `pingdotgg/t3code`

**The direct competitor.** Theo (t3.gg) and Julius. Site `t3.codes`, hosted app `app.t3.codes`.

A Node server wraps provider CLIs — Codex, Claude Code, Cursor, Grok, opencode, Antigravity —
and serves web, Electron desktop, and React Native mobile clients. That is our pitch with a
different primary metaphor.

What they built, technically:
- **WebSocket RPC**, typed via a shared `packages/contracts` schema.
- **Event-sourced**: command → decider → persisted events → projector → read model. Side
  effects run in queue-backed reactors emitting receipts, so a command ack is not "work done."
- Provider CLIs as subprocesses via `node-pty`; per-provider adapters normalize their protocols.
- **Checkpoints as hidden git refs** — every turn checkpoints, enabling diff and restore without
  touching the user's branch. (Notably: refs, not worktrees. They isolate *in time*; we isolate
  *in space*. Ours permits genuine concurrency; theirs does not, as far as the source shows.)
- Three connectivity tiers: direct LAN, Tailscale HTTPS, and "T3 Connect" — a Cloudflare Worker
  relay that brokers discovery and mints short-lived DPoP-bound credentials but **does not proxy
  traffic**. The relay never sees a session token. Genuinely good design.
- Effect-TS + SQLite event store, Bun, pnpm + `vite-plus`, Clerk for cloud identity.

**What this means for us.** Feature-matching them is a losing race — they have a team, a
distribution channel, and a year of head start on surface area. The only defensible position is
the interaction model: a *board of concurrent, isolated, reviewable work* versus a *better chat
with an agent*. If a user can't feel that difference in thirty seconds, we have no product.

Their weak spot, from the source: no per-task filesystem isolation. Their concurrency story is
checkpoint-and-restore, not parallel worktrees. That is the gap we build into.

## opencode — `sst/opencode`

Not a competitor — a well-engineered reference for the server half.

- **HTTP + SSE**, not WebSocket, for the main event bus. 15s heartbeats. Validates our transport
  choice at real scale.
- `packages/protocol` (Effect Schema) is the single source of truth generating OpenAPI *and*
  client SDKs. Both they and t3code independently converged on a contracts package.
- **In-process worker + ~60-line JSON RPC** means the local TUI opens no TCP port at all; the
  `fetch` is monkey-patched to route over `postMessage`. A real listener starts only on
  `--port`/`--mdns`, with bearer auth. The single best idea in the codebase; we're taking it.
- Auth: `auth.json` at 0600 under XDG data dir, plus a plugin interface
  (`{methods, authorize, callback}`) supporting device-code and paste-code OAuth, extensible by
  third-party npm packages.
- Permissions: wildcard rules → `allow`/`deny`/`ask` as a *pure function*, with a `Deferred`
  blocking the tool call until a client answers. Easy to test. Copying the shape.
- Sessions persist as flat JSON files with numbered migrations — not SQLite.
- Their own sync design doc is candid that retrofitting event sourcing left them running two
  parallel event systems with a compatibility shim. **We start event-sourced to avoid this.**
- Carries 8+ patch files against `@ai-sdk/*` packages — budget for that friction if we ever
  adopt Vercel AI SDK for direct model access.
- Heavy Effect-TS. Excellent for correctness, a permanent onboarding tax. We're declining.

## pi — `earendil-works/pi`

Mario Zechner's terminal agent harness. Relevant mainly for TUI craft.

`pi-tui` is a custom, dependency-light framework: differential rendering (only changed rows
redraw), CSI 2026 synchronized output for flicker-free atomic updates, flexbox-ish layout,
inline images via Kitty/iTerm2 protocols, OSC 133 semantic prompts. Two renderers — one into
normal scrollback, one alt-screen.

Architecturally it is a single local process; its RPC layer (CBOR over Unix sockets) is
explicitly marked experimental. No cloud counterpart. No permission system at all — the README
tells you to containerize if you need isolation.

## opentui — `sst/opentui`

Terminal UI framework with a **native Zig rendering core** and genuine React and Solid
reconcilers — `<box>`, `<text>`, `<input>` as host elements, flexbox layout, `useKeyboard()`.
Mount with `createRoot(renderer).render(<App/>)`.

Credibility: opencode's TUI is built on it, at real scale. Caution: pre-1.0 feel — `render()`
already deprecated for `createRoot()`, and a known quirk where a connected DevTools WebSocket
prevents clean process exit. Note the GitHub org appeared inconsistently in research
(`sst/opentui` vs `anomalyco/opentui`) — verify before pinning.

**Our call:** opentui for the TUI, but the TUI is a *secondary* client in v1. If it fights us,
Ink is the boring fallback and we lose nothing structural, because the TUI is a thin renderer
over the same API the web client uses.
