import { existsSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentId, AgentInfo } from "@kandy/core"
import type { AgentAdapter } from "./types.js"
import { codex } from "./codex.js"
import { claude } from "./claude.js"

const exec = promisify(execFile)

/**
 * Registry. Adding an agent is adding a file here — a provider becoming
 * unavailable must be a config change, not a rewrite. Do not build a product
 * that depends on exactly one provider's goodwill.
 */
export const ADAPTERS: Partial<Record<AgentId, AgentAdapter>> = {
  claude,
  codex,
}

export function adapter(id: AgentId): AgentAdapter | undefined {
  return ADAPTERS[id]
}

export async function detect(a: AgentAdapter): Promise<AgentInfo> {
  let installed = false
  let version: string | null = null
  try {
    const { stdout } = await exec(a.bin, ["--version"], { timeout: 5000 })
    installed = true
    version = stdout.trim().split("\n")[0] ?? null
  } catch {
    installed = false
  }
  return {
    id: a.id,
    installed,
    // Existence only. We never open these files.
    authed: a.credentials.some((p) => existsSync(p)),
    version,
  }
}

export async function detectAll(): Promise<AgentInfo[]> {
  return Promise.all(Object.values(ADAPTERS).map(detect))
}

export type { AgentAdapter, AgentEvent, SpawnOptions } from "./types.js"
