import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { STATE_DIR } from "../paths.js"

/**
 * Models you added yourself.
 *
 * The escape hatch that makes the curated tier survivable. A provider ships a
 * model on a Tuesday; the CLI may not list it, our curated list certainly does
 * not yet, and without this the answer is "wait for a release". With it the
 * answer is "type the id".
 *
 * A plain file rather than an event, because this is a fact about the machine
 * and its CLIs — not about a board. It should survive deleting every board,
 * and it should not be replicated to anyone kandy ever shares a board with.
 */

const FILE = path.join(STATE_DIR, "custom-models.json")

type Stored = Record<string, string[]>

function read(): Stored {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as unknown
    if (!raw || typeof raw !== "object") return {}
    const out: Stored = {}
    for (const [agent, ids] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(ids)) out[agent] = ids.filter((m): m is string => typeof m === "string")
    }
    return out
  } catch {
    return {}
  }
}

export function customModels(agent: string): string[] {
  return read()[agent] ?? []
}

/** Replaces the list for one agent. Empty removes it. */
export function setCustomModels(agent: string, ids: readonly string[]): string[] {
  const clean = [...new Set(ids.map((m) => m.trim()).filter(Boolean))]
  const all = read()
  if (clean.length > 0) all[agent] = clean
  else delete all[agent]
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 })
  return clean
}
