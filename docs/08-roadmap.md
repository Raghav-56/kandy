# Roadmap

Ordered by "what would make this real," not by what's easy.

> **Where we are:** M0 and M1 are done, and most of M2. kandy runs real work on
> its own codebase — concurrent isolated runs, live transcript, steering, and a
> review flow that merges. What M2 still owes is answering a permission prompt
> *in flight* rather than only seeing that one was refused.

## M0 — the spine ✅

- Monorepo, shared protocol package, typed client.
- Server: SQLite event log, command handlers, SSE stream, board projection.
- Web: board renders, notes create/edit/move, live across two browser tabs.
- No agents yet.

**Done when:** two tabs open, drag a note in one, it moves in the other. That proves the whole
architecture end to end and takes days, not weeks.

## M1 — one agent, one note, real isolation ✅

- Worktree manager: create, track, clean up.
- Two adapters. Codex was written first for its documented headless mode and explicit sandbox
  flags; Claude Code followed once we had captured its real stream-json output, and it is now the
  reference because it is the only one that accepts mid-turn steering.
- `run.output` streaming to the note card.
- Cancel a run.

**Done when:** write a note, click run, watch it work, end up with a branch.

## M2 — the actual product (mostly done)

- **Concurrency.** N notes running at once, each in its own worktree, with a configurable slot
  limit. This is the moment kandy becomes different from every chat-shaped tool.
- **Review.** A note in `review` shows a diff and three buttons: merge, discard, revise. Revise
  resumes the agent's session in the same worktree.
- **Blocked.** ⚠️ Half done. Refusals surface — Claude auto-denies in headless mode and reports
  each one — but we cannot yet *answer* them: by the time the note goes blocked the agent has
  moved on. Answering in flight needs `canUseTool`, which means running the agent in-process
  instead of as a subprocess. That is a real fork in the architecture, not a tweak.
- **Permissions policy.** ✅ Per note, *repo only* or *full access*, chosen by the user.

**Done when:** you run five notes over lunch and review them in ten minutes.

This is the demo. Everything before it is plumbing and everything after it is expansion.

## M3 — breadth

- Remaining adapters: Claude Code, Cursor, opencode (via ACP), Gemini, Grok.
- Agent detection: which are installed, which are authed.
- ✅ TUI client — live, subscribes to the event stream and redraws. Plain ANSI,
  no dependencies. opentui if and when it earns its place.
- Board setup command (`pnpm install` after worktree create) and ignored-file allowlist.
- Worktree GC.

## M4 — reach

- `kandy serve --port` with bearer auth.
- Tunnel-based remote access. Relay brokers, never proxies. No hosted copy of user data.
- Push notification when a note goes blocked or lands in review — the thing that makes "walk
  away from the board" actually work.

## M5 — later, if earned

- Desktop via Tauri wrapping the web client. Not Electron.
- Dependencies between notes ("B starts when A lands").
- Multiplayer boards (see `07-sync.md`).
- Sharing a note with a teammate who runs their own agent (see `11-going-multiplayer.md`).
- Templates / recurring notes.

## Explicitly deferred

**Sandboxing beyond worktrees.** Worktrees bound filesystem blast radius within the repo. They
do not stop an agent from touching the network or `$HOME`. Real sandboxing is a serious project;
it should be a deliberate M5+ decision, not something half-built early.

**Any cloud storage of user content.** The moment we store boards server-side we inherit
security, compliance, and trust obligations we're not equipped for and don't need.

> Under active tension. A hosted sharing tier would contradict this, and sharing may be the
> whole moat — see [`11-going-multiplayer.md`](11-going-multiplayer.md). The escape hatch is
> that a relay storing an encrypted log it cannot read inherits far less of that burden. Not
> decided; deliberately still deferred here until a share works between two laptops at all.

## The one thing to protect

M2 is the product. It is tempting to spend M1 polishing the board, and to spend M3 adding
agents because each one feels like progress. Neither makes anyone want this.

Concurrency and review are the difference between a nicer terminal agent and a new way to work.
Get there fast, then judge honestly whether it feels as good as it sounds.
