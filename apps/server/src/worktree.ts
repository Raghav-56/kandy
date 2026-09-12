import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { worktreeRoot } from "./paths.js"

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * Our worktree directory lives inside the repo so git can share the object
 * store. That makes the repo dirty, which would trip the repo_dirty guard on
 * every run after the first.
 *
 * Exclude it via .git/info/exclude rather than the tracked .gitignore — it is
 * our bookkeeping, not something to commit into the user's project.
 */
function ensureExcluded(repoPath: string): void {
  const gitDir = path.join(repoPath, ".git")
  const exclude = path.join(gitDir, "info", "exclude")
  const entry = "/.kandy/"
  try {
    mkdirSync(path.dirname(exclude), { recursive: true })
    const current = readFileSync(exclude, "utf8")
    if (current.split("\n").some((l) => l.trim() === entry)) return
    appendFileSync(exclude, `\n# added by kandy\n${entry}\n`)
  } catch {
    // A worktree or submodule has a .git *file*, not a directory. Not fatal —
    // the user will see .kandy/ as untracked, which is ugly but not wrong.
  }
}

export type Worktree = {
  path: string
  branch: string
  baseRef: string
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "note"
  )
}

/**
 * The load-bearing piece. Every note runs in its own checkout on its own
 * branch, so N agents can work the same repo without seeing each other's
 * writes — and so the user's actual working tree is never touched.
 */
export async function createWorktree(
  repoPath: string,
  noteId: string,
  title: string,
): Promise<Worktree> {
  // Resolve the base commit now and record it. A note queued at 2pm must not
  // silently rebase onto whatever main looks like when a slot frees up.
  const baseRef = await git(repoPath, "rev-parse", "HEAD")

  ensureExcluded(repoPath)
  const root = worktreeRoot(repoPath)
  mkdirSync(root, { recursive: true })

  const dir = path.join(root, noteId)
  const branch = `kandy/${noteId}-${slug(title)}`

  await git(repoPath, "worktree", "add", "-b", branch, dir, baseRef)
  return { path: dir, branch, baseRef }
}

/** Agents are inconsistent about committing. Capture whatever they left. */
export async function commitLeftovers(wt: Worktree, message: string): Promise<boolean> {
  const status = await git(wt.path, "status", "--porcelain")
  if (!status) return false
  await git(wt.path, "add", "-A")
  await git(wt.path, "commit", "-m", message, "--no-verify")
  return true
}

export async function diffStat(wt: Worktree): Promise<string> {
  return git(wt.path, "diff", "--stat", `${wt.baseRef}...HEAD`)
}

export async function diff(wt: Worktree): Promise<string> {
  return git(wt.path, "diff", `${wt.baseRef}...HEAD`)
}

export async function removeWorktree(repoPath: string, dir: string, force = false): Promise<void> {
  await git(repoPath, "worktree", "remove", ...(force ? ["--force"] : []), dir)
}

/** True if the user has uncommitted work. Notes branch from HEAD and won't see
 *  it — a board whose agents silently can't see your last hour is a betrayal,
 *  so callers surface this rather than swallowing it. */
export async function isDirty(repoPath: string): Promise<boolean> {
  return (await git(repoPath, "status", "--porcelain")) !== ""
}
