import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { DiffStat } from "@kandy/core"
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

/**
 * Structured diff size, so the UI can draw a bar instead of printing a
 * sentence. Parsed from --shortstat, e.g.
 *   " 2 files changed, 105 insertions(+), 1 deletion(-)"
 */
export async function diffNumbers(wt: Worktree): Promise<DiffStat> {
  const line = await git(wt.path, "diff", "--shortstat", `${wt.baseRef}...HEAD`).catch(() => "")
  const num = (re: RegExp) => Number(line.match(re)?.[1] ?? 0)
  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  }
}

export async function diff(wt: Worktree): Promise<string> {
  return git(wt.path, "diff", `${wt.baseRef}...HEAD`)
}

export async function removeWorktree(repoPath: string, dir: string, force = false): Promise<void> {
  await git(repoPath, "worktree", "remove", ...(force ? ["--force"] : []), dir)
}

/**
 * Land a note's branch on the base branch it came from.
 *
 * Merged with --no-ff so a note is always one identifiable thing in history —
 * "what did kandy do here" stays answerable a month later. A conflict is
 * reported rather than resolved; the user has a worktree and an editor, and
 * guessing at a merge on their behalf is how trust dies.
 */
export async function mergeBranch(
  repoPath: string,
  branch: string,
): Promise<{ merged: boolean; conflict?: string }> {
  try {
    await git(repoPath, "merge", "--no-ff", "-m", `kandy: merge ${branch}`, branch)
    return { merged: true }
  } catch (err) {
    // Leave the repo clean rather than parked in a half-merge the user has to
    // discover on their own.
    await git(repoPath, "merge", "--abort").catch(() => {})
    return { merged: false, conflict: err instanceof Error ? err.message : String(err) }
  }
}

export async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, "branch", "-D", branch).catch(() => {})
}

/**
 * Copy gitignored paths into a fresh worktree, by reference where possible.
 *
 * `cp -c` asks APFS for a clonefile(2) — the data blocks are shared until
 * something writes, so this costs metadata rather than bytes. Linux gets the
 * same via `--reflink=auto` on btrfs/XFS, which silently degrades to a real
 * copy elsewhere. Both fall back to a plain copy, because a slow worktree
 * beats a broken one.
 *
 * Note this is for `.env` files and build caches — NOT node_modules. pnpm's
 * store already clones packages by reference, so a fresh `pnpm install` is
 * sub-second; copying the tree ourselves would be slower and would hand two
 * agents the same resolved dependency graph even when their lockfiles differ.
 */
export async function carryInto(
  repoPath: string,
  worktree: string,
  paths: readonly string[],
): Promise<string[]> {
  const carried: string[] = []
  const reflink = process.platform === "darwin" ? ["-c"] : ["--reflink=auto"]

  for (const rel of paths) {
    // Never let a board config escape the repo it belongs to.
    const from = path.resolve(repoPath, rel)
    if (!from.startsWith(path.resolve(repoPath) + path.sep)) continue
    if (!existsSync(from)) continue

    const to = path.join(worktree, rel)
    try {
      mkdirSync(path.dirname(to), { recursive: true })
      await exec("cp", [...reflink, "-R", from, to])
      carried.push(rel)
    } catch {
      try {
        await exec("cp", ["-R", from, to])
        carried.push(rel)
      } catch {
        // A missing cache is a slower run, not a failed one.
      }
    }
  }
  return carried
}

/**
 * Run a board's setup command in a fresh worktree.
 *
 * Streamed line by line so the user watches it happen rather than staring at a
 * card that says "running" for ninety seconds with nothing behind it.
 */
export function runSetup(
  cwd: string,
  command: string,
  onLine: (line: string) => void,
): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const read = (stream: NodeJS.ReadableStream | null) => {
      let buf = ""
      stream?.on("data", (c: Buffer) => {
        buf += c.toString()
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const l of lines) if (l.trim()) onLine(l.trim())
      })
    }
    read(child.stdout)
    read(child.stderr)
    child.on("error", (err) => {
      onLine(err.message)
      resolve({ ok: false, code: null })
    })
    child.on("exit", (code) => resolve({ ok: code === 0, code }))
  })
}

/** Gitignored paths worth carrying, if the repo actually has them. */
function guessCarry(root: string): string[] {
  const candidates = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".turbo",
    ".nx",
  ]
  return candidates.filter((c) => existsSync(path.join(root, c)))
}

/** What "ready to work" probably means for this repo, guessed from lockfiles. */
function guessSetup(root: string): string | null {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm install --prefer-offline"
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn install --prefer-offline"
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock")))
    return "bun install"
  if (existsSync(path.join(root, "package-lock.json"))) return "npm ci --prefer-offline"
  if (existsSync(path.join(root, "package.json"))) return "npm install"
  if (existsSync(path.join(root, "uv.lock"))) return "uv sync"
  if (existsSync(path.join(root, "poetry.lock"))) return "poetry install"
  if (existsSync(path.join(root, "Cargo.toml"))) return "cargo fetch"
  if (existsSync(path.join(root, "go.mod"))) return "go mod download"
  return null
}

/** Inspect a path before offering to make a board of it. */
export async function checkRepo(p: string): Promise<{
  path: string
  exists: boolean
  isRepo: boolean
  dirty: boolean
  head: string | null
  branch: string | null
  name: string | null
  suggestedSetup: string | null
  suggestedCarry: string[]
  error: string | null
}> {
  const base = {
    path: p,
    exists: false,
    isRepo: false,
    dirty: false,
    head: null,
    branch: null,
    name: null,
    suggestedSetup: null,
    suggestedCarry: [],
    error: null,
  }
  if (!p.startsWith("/")) return { ...base, error: "path must be absolute" }
  if (!existsSync(p)) return { ...base, error: "no such directory" }

  try {
    // --show-toplevel rather than a .git check: a path *inside* a repo should
    // resolve to the repo, not be rejected.
    const root = await git(p, "rev-parse", "--show-toplevel")
    const [head, branch, status] = await Promise.all([
      git(root, "rev-parse", "--short", "HEAD").catch(() => ""),
      git(root, "rev-parse", "--abbrev-ref", "HEAD").catch(() => ""),
      git(root, "status", "--porcelain"),
    ])
    return {
      path: root,
      exists: true,
      isRepo: true,
      dirty: status !== "",
      head: head || null,
      branch: branch || null,
      name: path.basename(root),
      suggestedSetup: guessSetup(root),
      suggestedCarry: guessCarry(root),
      error: null,
    }
  } catch {
    return { ...base, exists: true, error: "not a git repository" }
  }
}

/** True if the user has uncommitted work. Notes branch from HEAD and won't see
 *  it — a board whose agents silently can't see your last hour is a betrayal,
 *  so callers surface this rather than swallowing it. */
export async function isDirty(repoPath: string): Promise<boolean> {
  return (await git(repoPath, "status", "--porcelain")) !== ""
}
