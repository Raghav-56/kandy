# Worktree isolation

## The problem

Six agents, one repository, one working tree. Agent A writes `src/auth.ts` while agent B is
halfway through reading it. Agent C runs `git stash`. This is not a rare race — it is the
normal outcome, and it is silent.

Any product that puts multiple agents on one repo without isolation is producing corrupted
output and calling it a feature.

## The mechanism

```
your-repo/                      ← never touched by an agent
  .git/
  .kandy/
    worktrees/
      note_01h9x.../            ← agent cwd, own checkout
      note_01h9y.../
```

On `run.requested`:

1. Resolve the base ref (default: the repo's current HEAD at queue time, recorded on the run —
   not resolved lazily, so a note queued at 2pm doesn't silently rebase onto 5pm's main).
2. `git worktree add -b kandy/<id>-<slug> .kandy/worktrees/<id> <base>`
3. Spawn the agent with `cwd` set to that path.

On `run.finished`:

- Commit anything the agent left uncommitted (agents are inconsistent about this) with a
  generated message attributed to the note.
- Compute `git diff --stat <base>...<branch>` for the review card.
- Leave the worktree in place — review needs it, and re-creating it is slower than keeping it.

On `review.decided`:

- `merge` → merge or rebase onto the base branch, then `git worktree remove`.
- `discard` → `git worktree remove --force` and delete the branch.
- `revise` → keep everything, start a new run in the *same* worktree, resuming the agent's
  session so it retains context.

## Details that will bite

**`.gitignore`d files don't come along.** `node_modules`, `.env`, build caches — a fresh
worktree has none of them. An agent that needs to run tests will fail immediately.

Options, in order of preference:
1. A per-board `setup` command run once after worktree creation (`pnpm install`, etc.).
2. Symlink specific heavy paths (`node_modules`) from the main tree — fast, but unsafe if two
   agents install different deps.
3. Copy an explicit allowlist of ignored files (`.env`, `.env.local`).

v1 does (1) and (3). (2) is an opt-in escape hatch, not a default.

**Disk.** A worktree per note is cheap (git shares the object store) but the *build artifacts*
are not. Ten notes with `node_modules` each is real gigabytes. Needs a GC policy: worktrees for
`done` notes older than N days get removed.

**Nested repos and submodules.** Untested territory. Detect and refuse clearly rather than
half-work.

**Uncommitted changes in the main tree.** If the user has dirty state, notes branch from HEAD
and won't see it. Surface this — a board whose agents can't see your last hour of work, without
telling you, is a betrayal.

## Why not containers

Stronger isolation, and eventually right for untrusted work. But: slow cold start, a Docker
dependency on every user's machine, broken inheritance of the CLI credentials the whole design
depends on, and no access to the user's installed toolchain. Worktrees give us the isolation
that actually matters here — concurrent filesystem writes — at near-zero cost.
