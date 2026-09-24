import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AgentId } from "@kandy/core"
import { STATE_DIR } from "./paths.js"
import { adapter } from "./agents/index.js"

/**
 * Agents whose sign-in a real run proved dead.
 *
 * A credential file outlives the credential in it, and every CLI's own init
 * succeeds on cache, so the only certain signal is a run being refused. That
 * observation used to live in a `Map` on the Runner, which meant restarting
 * the daemon put a revoked token back to "ready" — the warning vanished while
 * the problem stayed, which is the wrong way round for the two to disagree.
 *
 * The original argument for memory was that a restart should re-learn rather
 * than repeat a stale warning. That worry is real and is answered directly
 * below instead of by forgetting everything: a failure is dropped the moment
 * the agent's credential file is written again, because signing back in is
 * what rewrites it. So the record survives a restart and cannot outlive the
 * fix.
 */
const FILE = path.join(STATE_DIR, "auth-failures.json")

let held: Record<string, number> | null = null

function load(): Record<string, number> {
  if (held) return held
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>
    held = {}
    for (const [agent, at] of Object.entries(raw)) {
      if (typeof at === "number" && Number.isFinite(at)) held[agent] = at
    }
  } catch {
    held = {}
  }
  return held
}

function save(all: Record<string, number>): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n")
  } catch {
    // Losing the record costs a warning, not correctness — the next refused
    // run records it again.
  }
}

export function recordAuthFailure(agent: AgentId, at = Date.now()): void {
  const all = load()
  if (all[agent] === at) return
  all[agent] = at
  save(all)
}

export function clearAuthFailure(agent: AgentId): void {
  const all = load()
  if (!(agent in all)) return
  delete all[agent]
  save(all)
}

/**
 * When this agent last wrote a credential, or null if it keeps none we know of.
 *
 * The newest of them: Claude Code writes `.credentials.json` on refresh and
 * leaves `.claude.json` alone, so the oldest would never move.
 */
function credentialsWrittenAt(agent: AgentId): number | null {
  const files = adapter(agent)?.credentials ?? []
  let newest: number | null = null
  for (const f of files) {
    try {
      const at = statSync(f).mtimeMs
      if (newest === null || at > newest) newest = at
    } catch {
      // Gone is not newer. A missing credential file is its own kind of
      // signed-out, which detection already reports.
    }
  }
  return newest
}

/**
 * Failures that are still true, having dropped any the user has since fixed.
 *
 * Re-signing-in rewrites the credential file, so a file newer than the failure
 * means the failure is answered. The record is deleted rather than filtered,
 * so it stops being reconsidered on every poll of `/agents`.
 */
export function authFailures(): { agent: AgentId; at: number }[] {
  const all = load()
  const live: { agent: AgentId; at: number }[] = []
  let changed = false

  for (const [agent, at] of Object.entries(all)) {
    const written = credentialsWrittenAt(agent as AgentId)
    if (written !== null && written > at) {
      delete all[agent]
      changed = true
      continue
    }
    live.push({ agent: agent as AgentId, at })
  }

  if (changed) save(all)
  return live
}
