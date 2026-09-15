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
 * The git repositories on this machine, most recently touched first.
 *
 * Browsing a filesystem to find a repo means reading past Applications and
 * DaVinci Resolve Media to get to the four folders that could ever be an
 * answer. This looks one level inside the places people keep code and returns
 * only directories that actually contain a `.git`, which is the list the
 * dialog was asking you to assemble by hand.
 *
 * One level deep on purpose. A full scan of a home directory is slow, hits
 * node_modules and Library, and finds vendored repos nobody wants to adopt.
 * Anything kept somewhere unusual still has the path field and the native
 * picker.
 */
export function repos(limit = 40): Entry[] {
  const home = homedir()
  const roots = ["Developer", "Projects", "code", "src", "work", "repos", "dev", "git", "Documents"]
  const found: { entry: Entry; at: number }[] = []
  const seen = new Set<string>()

  const consider = (dir: string) => {
    if (seen.has(dir) || !existsSync(path.join(dir, ".git"))) return
    seen.add(dir)
    let at = 0
    try {
      at = statSync(path.join(dir, ".git")).mtimeMs
    } catch {
      // Unreadable is not a reason to hide it; it just sorts last.
    }
    found.push({ entry: { name: path.basename(dir), path: dir, isRepo: true }, at })
  }

  consider(home)
  for (const r of roots) {
    const root = path.join(home, r)
    if (!existsSync(root)) continue
    consider(root)
    let kids: string[] = []
    try {
      kids = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => path.join(root, d.name))
    } catch {
      continue
    }
    for (const k of kids) consider(k)
  }

  return found.sort((a, b) => b.at - a.at).slice(0, limit).map((f) => f.entry)
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
