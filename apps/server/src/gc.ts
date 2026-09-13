import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import type { Note, Outcome } from "@kandy/core"
import { worktreeRoot } from "./paths.js"

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * A worktree that has outlived the note it was made for.
 *
 * A finished note's checkout is dead weight — the diff is already snapshotted
 * and the branch still holds the commits — but nothing removes it unless the
 * daemon that created it is still alive to remember it. Restart the daemon and
 * every checkout it was holding becomes invisible litter inside the user's
 * repo, one full copy of the tree per note.
 */
export type Reclaimable = {
  noteId: string
  title: string
  path: string
  branch: string | null
  /** How the note ended. Null for a note that finished without a verdict. */
  outcome: Outcome | null
  /** Size on disk, as `du` reports it — node_modules and build output included. */
  bytes: number
  /** Commits on the branch that the repo's current HEAD does not have. */
  unmerged: number
  /** Uncommitted or untracked files in the worktree. */
  dirty: boolean
}

/** Registered worktrees, from git rather than from a directory listing — a
 *  stale directory git no longer knows about is not ours to delete. */
export async function listWorktrees(
  repoPath: string,
): Promise<{ path: string; branch: string | null }[]> {
  const out = await git(repoPath, "worktree", "list", "--porcelain").catch(() => "")
  const trees: { path: string; branch: string | null }[] = []
  for (const block of out.split("\n\n")) {
    const dir = block.match(/^worktree (.+)$/m)?.[1]
    if (!dir) continue
    const ref = block.match(/^branch (.+)$/m)?.[1] ?? null
    trees.push({ path: dir, branch: ref?.replace(/^refs\/heads\//, "") ?? null })
  }
  return trees
}

/** Size on disk in bytes. `du` is the only thing that counts a tree quickly;
 *  a failure costs us the number, not the removal. */
async function sizeOf(dir: string): Promise<number> {
  const out = await exec("du", ["-sk", dir]).then((r) => r.stdout).catch(() => "")
  return Number(out.split(/\s+/)[0] ?? 0) * 1024
}

/**
 * Worktrees whose note is finished — merged or discarded.
 *
 * Matched by directory name, which is the note id, because that is the link
 * createWorktree makes. A note still queued, running or waiting on review keeps
 * its checkout: the whole point of the worktree is that it is there when you
 * open the diff.
 */
export async function findReclaimable(repoPath: string, notes: Note[]): Promise<Reclaimable[]> {
  const root = worktreeRoot(repoPath)
  const byId = new Map(notes.map((n) => [n.id, n]))

  const candidates = (await listWorktrees(repoPath))
    .filter((w) => path.dirname(w.path) === root)
    .map((w) => ({ ...w, note: byId.get(path.basename(w.path)) }))
    // A note we've never heard of is not ours to judge — it may belong to
    // another board on the same repo, or to a note this board hasn't loaded.
    .filter((w) => w.note?.status === "done")

  return Promise.all(
    candidates.map(async (w) => {
      const note = w.note!
      const branch = w.branch ?? note.branch
      return {
        noteId: note.id,
        title: note.title,
        path: w.path,
        branch,
        outcome: note.outcome,
        bytes: await sizeOf(w.path),
        unmerged: branch ? await aheadOfHead(repoPath, branch) : 0,
        dirty: await isDirty(w.path),
      }
    }),
  )
}

/**
 * Commits on `branch` that the repo's current branch does not already have.
 *
 * This is the same base a merge from the board would use, so "unmerged" here
 * means what the user would mean by it. Unknowable counts as unmerged: refusing
 * to guess is the safe direction.
 */
async function aheadOfHead(repoPath: string, branch: string): Promise<number> {
  const out = await git(repoPath, "rev-list", "--count", `HEAD..${branch}`).catch(() => "1")
  return Number(out) || 0
}

async function isDirty(dir: string): Promise<boolean> {
  return (await git(dir, "status", "--porcelain").catch(() => "")) !== ""
}

/** Why a worktree was left alone. `null` means it can go. */
export function heldBack(item: Reclaimable, force: boolean): string | null {
  if (force) return null
  if (item.unmerged > 0)
    return `${item.unmerged} commit${item.unmerged === 1 ? "" : "s"} not on this branch`
  if (item.dirty) return "uncommitted changes"
  return null
}

/**
 * Remove one worktree. The branch is deliberately left behind: it is the only
 * copy of the work once the checkout is gone, and it costs a few kilobytes.
 */
export async function reclaim(repoPath: string, item: Reclaimable, force: boolean): Promise<void> {
  await git(repoPath, "worktree", "remove", ...(force ? ["--force"] : []), item.path)
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
