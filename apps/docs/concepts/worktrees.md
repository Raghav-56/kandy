# Worktrees

The load-bearing decision.

## The problem

Six agents, one repository, one working tree. Agent A writes `src/auth.ts` while
agent B is halfway through reading it. Agent C runs `git stash`. This is not a
rare race — it is the normal outcome, and it is silent.

Any tool that puts several agents on one repo without isolation is producing
corrupted output and calling it a feature.

## The mechanism

```
your-repo/                   ← never touched by an agent
  .git/
  .kandy/worktrees/
    note_01h9x.../           ← agent cwd, own checkout, own branch
    note_01h9y.../
```

When a note runs, kandy resolves the base commit **now** and records it — a note
queued at 2pm must not silently rebase onto whatever `main` looks like when a
slot frees up — then creates a worktree and branch from it.

The branch is the deliverable. Review is `git diff main...branch`.

## Making it usable

A fresh worktree has no `node_modules`, no `.env`, no build cache. An agent that
writes a test and then cannot run it is worse than useless, so kandy prepares
the workspace before the agent arrives:

**Carry** — gitignored paths copied in by reference. `cp -c` asks APFS for a
`clonefile`, so blocks are shared until something writes; Linux gets the same
from `--reflink=auto` on btrfs and XFS. Both fall back to a real copy.

**Setup** — a shell command guessed from the repo's lockfiles, streamed into the
note's transcript so ninety seconds of install is visible rather than a card
that just says "running".

Measured on kandy's own repository:

| | |
| --- | --- |
| `git worktree add` | 0.07s |
| `pnpm install --prefer-offline` | 0.85s |

**pnpm already solves `node_modules`.** Its store is content-addressable and its
default import method on APFS is `clone`, so a fresh install costs little more
than the metadata walk. kandy deliberately does not copy `node_modules` itself:
that would be slower, and it would hand two agents the same resolved dependency
graph even when their lockfiles differ.

## What will bite

- **Uncommitted work is invisible.** Notes branch from `HEAD`, so anything
  uncommitted in your tree is not there. kandy says so in the transcript rather
  than letting you discover it.
- **Disk.** A worktree is cheap; ten `node_modules` are not. There is no
  collection yet.
- **Submodules and nested repos** are untested territory.
