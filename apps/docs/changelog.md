# Changelog

## 0.1.0-alpha.1

First tagged version. Alpha in the honest sense: it runs real work every day on
its own repository, and the parts that are unfinished are named below rather
than discovered.

Not published. Install it from a clone — `pnpm build`, then `pnpm link
--global` from `apps/server`.

### What works

- **Boards** point at a git repository. Notes are units of work with a
  lifecycle: draft → queued → running → review → done.
- **Isolation.** Every note runs in its own `git worktree` on its own branch, so
  several agents work the same repo at once without seeing each other's writes.
  Your working tree is never touched.
- **Workspaces are ready.** Gitignored paths are carried in by reference
  (`clonefile` on APFS, `--reflink` on Linux) and a setup command guessed from
  the repo's lockfiles runs before the agent arrives. Measured on this repo:
  worktree 0.07s, `pnpm install` 0.85s.
- **Agents.** Claude Code and Codex, written against their real captured output.
  Credentials are never read — the spawned CLI inherits your existing login.
- **Steering.** Send a message to a running agent, or queue a follow-up that
  resumes its session in the same worktree. Files can be attached.
- **Review.** A diff per file, then merge locally, open a PR, or discard. Each
  asks first, and says what will happen to that branch.
- **Cost.** Claude reports dollars; Codex reports tokens and is priced from the
  LiteLLM table. Which is which is tracked, so a mixed total says how much of it
  is estimated.
- **A CLI** — `kandy "do the thing"` from any repo — and a skill so other agents
  can queue work onto a board.

### Known gaps

- **`blocked` can be seen but not answered.** Refusals surface; you cannot
  approve one in flight. That needs the agent running in-process.
- **Only two agents.** Cursor, opencode, Gemini and Grok are named in the model
  but have no adapter.
- **No auth on the HTTP port.** It binds `127.0.0.1`, so nothing is exposed, but
  `--port` has no token yet.
- **No worktree GC.** Abandoned worktrees accumulate until a note is reviewed.
- **Codex cost is an estimate.** Codex reports no dollar figure, and a price
  table goes stale.
