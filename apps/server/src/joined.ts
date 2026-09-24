import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { CONFIG_DIR, STATE_DIR } from "./paths.js"

/**
 * The team hub this machine has joined, if any.
 *
 * `kandy join <url>` writes it; `kandy leave` removes it. While it exists,
 * this machine is part of a team: every command talks to the hub rather than
 * to a local daemon, and a runner in the background runs the notes placed
 * here. Without it, kandy is what it always was — one person, one machine.
 *
 * Kept in the config directory, not the state directory: it is a choice
 * someone made, not something kandy observed, and wiping state must not
 * quietly take a person off their team.
 */
export type Joined = {
  url: string
  /** Only for a hub with no identity. On a tailnet, Tailscale says who this is. */
  token: string
  /** Clones named at join time, so the runner serves exactly these. */
  repos: string[]
  /** Who the hub said we were when we joined — for status lines, never for auth. */
  email: string | null
  joinedAt: number
}

const FILE = path.join(CONFIG_DIR, "hub.json")

export function joinedHub(): Joined | null {
  // An escape hatch for scripts and for anyone who wants their own local
  // board while still on a team: KANDY_LOCAL=1 kandy …
  if (process.env["KANDY_LOCAL"] === "1") return null
  try {
    const j = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Joined>
    if (typeof j.url !== "string" || !/^https?:\/\//.test(j.url)) return null
    return {
      url: j.url.replace(/\/+$/, ""),
      token: typeof j.token === "string" ? j.token : "",
      repos: Array.isArray(j.repos) ? j.repos.filter((r) => typeof r === "string") : [],
      email: typeof j.email === "string" ? j.email : null,
      joinedAt: typeof j.joinedAt === "number" ? j.joinedAt : 0,
    }
  } catch {
    return null
  }
}

export function saveJoined(j: Joined): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  // 0600: a token hub's token is a credential, and this is where it lives.
  writeFileSync(FILE, JSON.stringify(j, null, 2) + "\n", { mode: 0o600 })
}

export function forgetJoined(): boolean {
  if (!existsSync(FILE)) return false
  rmSync(FILE, { force: true })
  return true
}

// ── the background runner ─────────────────────────────────────────────────

const PID = path.join(STATE_DIR, "runner.pid")
export const RUNNER_LOG = path.join(STATE_DIR, "runner.log")

/** Recorded by a runner as it starts, so the CLI can tell whether one is up. */
export function markRunner(pid: number): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(PID, String(pid) + "\n")
}

export function clearRunner(pid: number): void {
  // Only our own pid: a newer runner may already have taken the file.
  if (runnerPid() === pid) rmSync(PID, { force: true })
}

/** The background runner's pid, if it is alive. */
export function runnerPid(): number | null {
  try {
    const pid = Number(readFileSync(PID, "utf8").trim())
    if (!Number.isInteger(pid) || pid <= 0) return null
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}
