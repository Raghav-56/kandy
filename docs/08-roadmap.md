# Roadmap

Ordered by "what would make this real," not by what's easy.

## M0 — the spine (current scaffold)

- Monorepo, shared protocol package, typed client.
- Server: SQLite event log, command handlers, SSE stream, board projection.
- Web: board renders, notes create/edit/move, live across two browser tabs.
- No agents yet.

**Done when:** two tabs open, drag a note in one, it moves in the other. That proves the whole
architecture end to end and takes days, not weeks.

## M1 — one agent, one note, real isolation

- Worktree manager: create, track, clean up.
- One adapter. **Codex first**, not Claude — its headless mode is documented, its sandbox flags
  are explicit, and it carries none of the OAuth-policy ambiguity (see `05-agent-auth.md`).
- `run.output` streaming to the note card.
- Cancel a run.

**Done when:** write a note, click run, watch it work, end up with a branch.

## M2 — the actual product

- **Concurrency.** N notes running at once, each in its own worktree, with a configurable slot
  limit. This is the moment kandy becomes different from every chat-shaped tool.
- **Review.** A note in `review` shows a diff and three buttons: merge, discard, revise. Revise
  resumes the agent's session in the same worktree.
- **Blocked.** Permission requests surface as a blocked note, answerable from any client.

**Done when:** you run five notes over lunch and review them in ten minutes.

This is the demo. Everything before it is plumbing and everything after it is expansion.

## M3 — breadth

- Remaining adapters: Claude Code, Cursor, opencode (via ACP), Gemini, Grok.
- Agent detection: which are installed, which are authed.
- TUI client (opentui) — status and attach, not a full editor.
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
- Templates / recurring notes.

## Explicitly deferred

**Sandboxing beyond worktrees.** Worktrees bound filesystem blast radius within the repo. They
do not stop an agent from touching the network or `$HOME`. Real sandboxing is a serious project;
it should be a deliberate M5+ decision, not something half-built early.

**Any cloud storage of user content.** The moment we store boards server-side we inherit
security, compliance, and trust obligations we're not equipped for and don't need.

## The one thing to protect

M2 is the product. It is tempting to spend M1 polishing the board, and to spend M3 adding
agents because each one feels like progress. Neither makes anyone want this.

Concurrency and review are the difference between a nicer terminal agent and a new way to work.
Get there fast, then judge honestly whether it feels as good as it sounds.
