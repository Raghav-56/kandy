# Status: extremely experimental

kandy is being built in the open, fast. It builds itself every day — the numbers
on the home page are its own board — but it is not something to depend on yet.

## What that means for you

- **It changes daily.** Commands, flags and screens move. What's written here is
  true of `main` today and may not be tomorrow.
- **Your board may need wiping.** The data format isn't settled. If an update
  leaves a board unreadable, the fix is to delete
  `~/.local/state/kandy/` and start again. Your code is never at risk — notes
  work in their own worktrees and branches — but the board's history can be.
- **It installs from GitHub, not npm.** One command, from the newest release
  ([how](/guide/getting-started#install)). The name `kandy` on npm belongs to
  someone else — never run `npm i -g kandy`.
- **Nobody has audited it.** The security model is written down in
  [Who decides what](/modes/permissions) and tested, but it hasn't been reviewed
  by anyone else. Keep a hub on your tailnet — never expose one to the internet.
- **macOS and Linux only.** Windows hasn't been tried.

If something breaks, [open an issue](https://github.com/hiteshbandhu/kandy/issues)
with what you ran and what it printed.

## What's been tried, and how hard

| Part | How proven |
| --- | --- |
| Notes, worktrees, review, merge | used daily on this repository |
| Claude Code | used daily |
| Codex, Cursor | real runs, less often |
| The terminal board | driven for real: a note written, run by Claude, reviewed and merged from the keyboard |
| Skills and MCP | real Claude and Cursor runs calling a board's MCP server |
| Teams — hub, join, identity | run once end to end on a real tailnet: a hub in Docker, a Mac joined to it, a note run through it |
| Handoff between machines | two clones and two runners on one machine: Claude on one, Cursor continuing on the other |
| Consent, roles, invites | tested; used by very few people |
| opencode, aider | written against their real output formats; never driven end to end |

## What doesn't work yet

**Only Claude Code can ask permission.** Under repo-only access, Claude puts a
shell command to you on the board. Codex, Cursor and opencode can't — their
headless modes have no way to ask — so a refused command shows the note as
blocked, with a one-click way to continue with full access. Fixing it means
driving each over its richer protocol (Codex's app-server, Cursor's ACP,
opencode's server).

**Restarting the daemon kills running agents.** Agents are child processes. A
restart marks their runs failed rather than leaving the board wrong, and the
worktree survives so the note can continue — but the turn in progress is lost.

**Codex and Cursor costs are estimates.** They report tokens, not dollars; kandy
prices them from a public table and marks every such number `≈`. Your provider's
billing page is the source of truth.

**The terminal board shows agents' markdown raw** — `**bold**` and all. Some of
its team actions (answering consent, giving to a machine) have only been tested
against a fake board.

**A team needs Tailscale.** Without it a hub works on a single shared token,
which suits one person with two machines, not a team.

**No board without a daemon.** One process owns the state; the web and terminal
boards are views of it. Offline editing and syncing boards without a hub aren't
built — a spike exists (sharing over a git branch), and its write-up explains why
the handoff is the hard part.

## Coming next

Roughly in order: permission prompts for Codex, Cursor and opencode · publishing
to npm under a name of its own · real two-laptop testing of teams · markdown in the terminal board ·
keeping runs alive across a daemon restart.
