import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { McpServer } from "@kandy/core"
import { git } from "../worktree.js"
import { cursorMcpConfig } from "./mcp.js"

const run = promisify(execFile)

const REL = path.join(".cursor", "mcp.json")
const CLI_REL = path.join(".cursor", "cli.json")

/**
 * Put a board's servers where Cursor will find them, for one run, and take
 * them away again.
 *
 * Cursor has no flag for MCP servers. It reads `.cursor/mcp.json` in the
 * project and `~/.cursor/mcp.json`, the second resolved from `homedir()`
 * directly — `CURSOR_CONFIG_DIR` moves its login along with it, which would
 * sign the run out. So the worktree's project file is the only place to put
 * them that is not the user's own config.
 *
 * ## Three things this must not do
 *
 * **Leak into the reviewed diff.** The files are written into a git checkout
 * an agent is about to work in. A file the project already tracks is hidden
 * with `--skip-worktree` — per worktree, since each has its own index — so no
 * `git add -A` can take it. A new one cannot be hidden that way, and an agent
 * that commits everything will commit it; `undo` then deletes it and the
 * runner's leftover commit records the deletion, so the diff that is reviewed
 * and becomes the PR is exactly the agent's work. Measured, and tested as the
 * worst case. Neither file ever holds a secret: references are rewritten to
 * `${env:NAME}`, which Cursor expands itself.
 *
 * **Lose the project's own servers.** They are merged in and the file is
 * restored byte for byte afterwards.
 *
 * **Approve what the user did not.** `--approve-mcps` would have been one
 * flag, and it approves every server — including any a cloned repository
 * ships in its own `.cursor/mcp.json`, which is exactly the file an attacker
 * would put one in. Instead each *board* server is approved by name with
 * `cursor-agent mcp enable`, and the repository's are left as the user left
 * them. Verified headless: a board server goes from "not loaded (needs
 * approval)" to loaded, and nothing else changes.
 */
export async function placeCursorMcp(
  cwd: string,
  servers: readonly McpServer[],
  approve: (cwd: string, name: string) => Promise<void> = approveWithCursor,
): Promise<{ paths: string[]; undo: () => Promise<void> }> {
  if (servers.length === 0) return { paths: [], undo: async () => {} }

  const hadDir = existsSync(path.join(cwd, ".cursor"))

  const mcp = await placeJson<{ mcpServers?: Record<string, unknown> }>(cwd, REL, (existing) =>
    cursorMcpConfig(servers, existing),
  )

  /*
   * Approving a server loads it; it does not let its tools run. Headless,
   * Cursor rejects every MCP tool call it has not been told to allow — the
   * first real run here loaded the board's server, called its tool, and got
   * "User rejected MCP". Claude can put that question on the board; Cursor
   * has no channel to ask it on. So the choice is between board servers that
   * never work on Cursor and tools that are allowed, and the board owner made
   * that choice already by adding the server. Only board servers, by name —
   * the project's own stay as they were.
   */
  const cli = await placeJson<{ permissions?: { allow?: string[]; deny?: string[] } }>(
    cwd,
    CLI_REL,
    (existing) => {
      const allow = new Set(existing?.permissions?.allow ?? [])
      for (const s of servers) allow.add(`Mcp(${s.name}:*)`)
      return {
        ...(existing ?? {}),
        permissions: { ...(existing?.permissions ?? {}), allow: [...allow], deny: existing?.permissions?.deny ?? [] },
      }
    },
  )

  for (const s of servers) {
    try {
      await approve(cwd, s.name)
    } catch {
      // Unapproved means unloaded, which the run's transcript will show as a
      // missing tool. Not a reason to refuse the run itself.
    }
  }

  return {
    paths: [REL, CLI_REL],
    undo: async () => {
      await cli.undo()
      await mcp.undo()
      const dir = path.join(cwd, ".cursor")
      if (!hadDir && existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
    },
  }
}

/**
 * Write one JSON file into the worktree for a run, merged over what is there,
 * and hand back how to put it back.
 *
 * The three guarantees in the comment above live here, once, for every file:
 * a tracked file is hidden from this worktree's index with `--skip-worktree`
 * so no `git add -A` can take it; the original is restored byte for byte; and
 * a file that was not there is removed.
 */
async function placeJson<T>(
  cwd: string,
  rel: string,
  build: (existing: T | null) => unknown,
): Promise<{ undo: () => Promise<void> }> {
  const file = path.join(cwd, rel)
  const before = existsSync(file) ? readFileSync(file, "utf8") : null
  const tracked = await isTracked(cwd, rel)

  let existing: T | null = null
  if (before !== null) {
    try {
      existing = JSON.parse(before) as T
    } catch {
      // A file Cursor itself could not read contributes nothing. It is still
      // restored exactly as it was afterwards.
      existing = null
    }
  }

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(build(existing), null, 2) + "\n")
  if (tracked) await git(cwd, "update-index", "--skip-worktree", "--", rel)

  return {
    undo: async () => {
      if (tracked) await git(cwd, "update-index", "--no-skip-worktree", "--", rel).catch(() => {})
      if (before !== null) writeFileSync(file, before)
      else rmSync(file, { force: true })
    },
  }
}

/**
 * Cursor's own approval, by name. Stored per project under
 * `~/.cursor/projects/`, where Cursor already keeps state for every directory
 * it has run in — so a worktree gains no new kind of residue.
 */
async function approveWithCursor(cwd: string, name: string): Promise<void> {
  await run("cursor-agent", ["mcp", "enable", name], { cwd, timeout: 20_000 })
}

async function isTracked(cwd: string, rel: string): Promise<boolean> {
  try {
    return (await git(cwd, "ls-files", "--", rel)).trim() !== ""
  } catch {
    return false
  }
}
