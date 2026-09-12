import { execFile } from "node:child_process"
import { readdirSync, existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export type Entry = {
  name: string
  path: string
  isRepo: boolean
}

export type Listing = {
  path: string
  parent: string | null
  entries: Entry[]
  /** True when this directory is itself a git repo. */
  isRepo: boolean
}

/**
 * Browse the filesystem from the daemon.
 *
 * A browser cannot hand us a path — `<input type=file webkitdirectory>` gives
 * file handles, not a directory path, and we need a path to run git in. Since
 * the daemon is already local, it can list directories for a picker that
 * behaves like a real one.
 */
export function list(dir: string): Listing {
  const full = resolve(dir)
  const entries: Entry[] = []

  for (const name of readdirSync(full)) {
    // Dotfiles are noise in a project picker; .git is the thing we detect, not
    // something you would ever want to open.
    if (name.startsWith(".")) continue
    const p = path.join(full, name)
    try {
      if (!statSync(p).isDirectory()) continue
      entries.push({ name, path: p, isRepo: existsSync(path.join(p, ".git")) })
    } catch {
      // Permission denied on a single entry shouldn't empty the whole listing.
    }
  }

  entries.sort((a, b) =>
    a.isRepo === b.isRepo ? a.name.localeCompare(b.name) : a.isRepo ? -1 : 1,
  )

  const parent = path.dirname(full)
  return {
    path: full,
    parent: parent === full ? null : parent,
    entries,
    isRepo: existsSync(path.join(full, ".git")),
  }
}

export function resolve(dir: string): string {
  const p = dir.startsWith("~") ? path.join(homedir(), dir.slice(1)) : dir
  return path.resolve(p || homedir())
}

/**
 * Places a developer's repos actually live, so the picker opens somewhere
 * useful instead of at `/`.
 */
export function suggestions(): Entry[] {
  const home = homedir()
  const candidates = ["Developer", "Projects", "code", "src", "work", "repos", "dev", "git"]
  const out: Entry[] = [{ name: "Home", path: home, isRepo: false }]
  for (const c of candidates) {
    const p = path.join(home, c)
    if (existsSync(p)) out.push({ name: c, path: p, isRepo: existsSync(path.join(p, ".git")) })
  }
  return out
}

/**
 * The OS folder chooser, on macOS.
 *
 * The daemon and the browser are the same machine in normal use, so this is a
 * real native dialog rather than a web imitation of one. Everywhere else the
 * in-app browser above is the answer.
 */
export async function nativePick(): Promise<string | null> {
  if (process.platform !== "darwin") return null
  try {
    const { stdout } = await exec(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Choose a repository for kandy")'],
      { timeout: 120_000 },
    )
    return stdout.trim().replace(/\/$/, "") || null
  } catch {
    // Cancelling the dialog exits non-zero. That is a choice, not a failure.
    return null
  }
}
