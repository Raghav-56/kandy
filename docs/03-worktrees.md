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

## Preparing the workspace (measured, not guessed)

A fresh worktree has no `node_modules`, no `.env`, no build cache. An agent that
writes a test and then cannot run it is worse than useless, so kandy prepares
the workspace before the agent arrives.

Two mechanisms, in order:

**1. Carry** — gitignored paths cloned in by reference. `cp -c` asks APFS for a
`clonefile(2)`, so the blocks are shared until something writes; Linux gets the
same from `cp --reflink=auto` on btrfs/XFS. Both fall back to a real copy,
because a slow worktree beats a broken one. Defaults are guessed from what the
repo actually has: `.env*`, `.turbo`, `.nx`.

**2. Setup** — a shell command run in the new worktree, guessed from the repo's
lockfiles (`pnpm install --prefer-offline`, `npm ci`, `uv sync`, `cargo fetch`,
…). Its output streams into the note's transcript, so ninety seconds of install
is visible rather than a card that just says "running".

If setup fails the run stops there. Handing an agent a broken workspace only
moves the failure ten minutes later, into a transcript nobody reads.

### What we measured

On this repo (pnpm, 6 workspace packages, macOS/APFS):

| | |
| --- | --- |
| `git worktree add` | 0.07s |
| `pnpm install --prefer-offline` in the fresh worktree | **0.85s** |
| Total, as reported in the transcript | "workspace ready in 0.7–0.9s" |

**pnpm already solves `node_modules`.** Its store is content-addressable and its
default import method on APFS is `clone` — it is already calling `clonefile(2)`
per package. A fresh install costs little more than the metadata walk. This is
why kandy does *not* copy `node_modules` itself: doing so would be slower, and
it would hand two agents the same resolved dependency graph even when their
lockfiles differ.

For comparison, copying a 290MB `node_modules` by hand: `cp -c -R` 3.8s,
`cp -R` 6.3s. Copy-on-write helps, but not as much as people assume — the cost
of a tree with tens of thousands of small files is `readdir` and `mkdir`, not
moving bytes.

### Prior art

- **`lane`** (github.com/lukeed/lane) — a Rust binary that creates a worktree and
  clones *every* gitignored path by reference, retargeting absolute symlinks
  afterwards. anomalyco ship `opencode-plugin-lane` to make it opencode's
  worktree strategy. If our carry list grows teeth, this is the thing to adopt
  rather than reimplement.
- **Conductor** and **Cursor** both landed on a per-workspace setup script
  (`conductor.json`, `.cursor/worktrees.json`) — the same conclusion we reached.
  Cursor's docs explicitly warn against symlinking `node_modules`, which matches
  our reasoning: the moment two branches disagree about `package.json`, a shared
  tree gives one agent the other's dependencies.
- **Sculptor (Imbue)** rejects worktrees entirely and runs each agent in a
  container with dependencies baked into image layers. That is the right answer
  when you need real isolation or a multi-runtime toolchain; it costs seconds of
  start-up we don't currently need to spend.
