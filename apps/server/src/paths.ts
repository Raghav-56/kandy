import { homedir } from "node:os"
import { mkdirSync } from "node:fs"
import path from "node:path"

/**
 * XDG base directories, with the macOS-friendly fallback of using the same
 * ~/.local tree rather than ~/Library — one layout to reason about, and it
 * matches what the agent CLIs we shell out to already do.
 */
function xdg(envVar: string, fallback: string): string {
  // The spec says an empty or relative value is to be ignored. Taken as-is,
  // XDG_STATE_HOME="" put the board in ./kandy of whatever directory kandy
  // was started from — a different, empty board in every repo.
  const set = process.env[envVar]
  const dir = set && path.isAbsolute(set) ? set : path.join(homedir(), fallback)
  const full = path.join(dir, "kandy")
  mkdirSync(full, { recursive: true })
  return full
}

export const DATA_DIR = xdg("XDG_DATA_HOME", ".local/share")
export const STATE_DIR = xdg("XDG_STATE_HOME", ".local/state")
export const CONFIG_DIR = xdg("XDG_CONFIG_HOME", ".config")

export const DB_PATH = path.join(STATE_DIR, "kandy.db")
export const TOKEN_PATH = path.join(STATE_DIR, "token")

/** Worktrees live inside the target repo, not in our state dir, so that git
 *  object sharing works and so a user can find them without our help. */
export function worktreeRoot(repoPath: string): string {
  return path.join(repoPath, ".kandy", "worktrees")
}
