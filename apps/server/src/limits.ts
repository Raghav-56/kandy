import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AgentLimits } from "@kandy/core"
import { STATE_DIR } from "./paths.js"

/**
 * The last rate-limit reading per agent.
 *
 * A fact about the account, not about a board or a run, so it lives beside the
 * daemon rather than in the event log — and it is kept on disk so a restart
 * does not blank the one number people watch until their next run reports it.
 * Each reading carries when it was heard; the reset times say how stale it is.
 */
const FILE = path.join(STATE_DIR, "limits.json")

let held: Record<string, AgentLimits> | null = null

function load(): Record<string, AgentLimits> {
  if (held) return held
  try {
    held = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, AgentLimits>
  } catch {
    held = {}
  }
  return held
}

export function recordLimits(agent: string, limits: Omit<AgentLimits, "at">): void {
  const all = load()
  all[agent] = { ...limits, at: Date.now() }
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n")
  } catch {
    // Losing a reading is harmless; the next run reports another.
  }
}

export function limitsFor(agent: string): AgentLimits | null {
  return load()[agent] ?? null
}
