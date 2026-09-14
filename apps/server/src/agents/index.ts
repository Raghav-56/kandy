import { existsSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentId, AgentInfo } from "@kandy/core"
import type { AgentAdapter } from "./types.js"
import { codex } from "./codex.js"
import { claude } from "./claude.js"
import { aider } from "./aider.js"

const exec = promisify(execFile)

/**
 * Registry. Adding an agent is adding a file here — a provider becoming
 * unavailable must be a config change, not a rewrite. Do not build a product
 * that depends on exactly one provider's goodwill.
 */
export const ADAPTERS: Partial<Record<AgentId, AgentAdapter>> = {
  claude,
  codex,
  aider,
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
  /*
   * Existence is the floor, not the answer.
   *
   * A credential file outlives the credential in it. Claude Code's refresh
   * token expires and the file stays exactly where it was, so kandy reported
   * "ready" for a sign-in that had been dead for a month — and you found out
   * when a run failed instead of when you looked.
   *
   * Only the metadata beside the tokens is read: the expiry and the plan.
   * Agents that record no expiry return null for it, and null means "it did
   * not say", never "it is fine".
   */
  const present = a.credentials.length === 0 ? installed : a.credentials.some((p) => existsSync(p))
  const detail = present && a.readAuth ? a.readAuth() : null
  const expiresAt = detail?.expiresAt ?? null
  const expired = expiresAt !== null && expiresAt <= Date.now()

  return {
    id: a.id,
    installed,
    authed: present && !expired,
    version,
    expiresAt,
    plan: detail?.plan ?? null,
    // Filled in where runs are known; detection alone has never seen one fail.
    authFailedAt: null,
  }
}

export async function detectAll(): Promise<AgentInfo[]> {
  return Promise.all(Object.values(ADAPTERS).map(detect))
}

export type { AgentAdapter, AgentEvent, SpawnOptions } from "./types.js"
