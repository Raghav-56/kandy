import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { KandyClient } from "@kandy/client"
import { berry, dim } from "./banner.js"
import { mkdirSync, openSync } from "node:fs"
import { joinedHub, RUNNER_LOG, runnerPid, type Joined } from "../joined.js"

import { readToken } from "../auth.js"
import { TOKEN_PATH } from "../paths.js"

export const DEFAULT_PORT = 4477

/**
 * Where commands go: the team hub if this machine has joined one, otherwise
 * the daemon on this machine.
 *
 * One place decides it, so `kandy "fix the flash"`, `kandy ls` and the
 * terminal board all follow a `kandy join` without each knowing about it.
 * An explicit `--port` still means this machine's own daemon.
 */
export function client(port = DEFAULT_PORT): KandyClient {
  const hub = port === DEFAULT_PORT ? joinedHub() : null
  if (hub) return new KandyClient({ baseUrl: hub.url, token: () => hub.token })
  return new KandyClient({ baseUrl: `http://127.0.0.1:${port}`, token: () => readToken(TOKEN_PATH) })
}

/** The hub commands are going to, or null for this machine's own daemon. */
export function hubFor(port = DEFAULT_PORT): Joined | null {
  return port === DEFAULT_PORT ? joinedHub() : null
}

export async function isUp(port = DEFAULT_PORT): Promise<boolean> {
  try {
    await client(port).health()
    return true
  } catch {
    return false
  }
}

/**
 * Start the daemon if it isn't already running.
 *
 * Every other command needs it, and "start the server first" is a chore the
 * tool can do itself. Detached and with stdio ignored, so the shell that
 * happened to run `kandy new` isn't the thing keeping your agents alive.
 */
export async function ensureUp(port = DEFAULT_PORT): Promise<boolean> {
  const hub = hubFor(port)
  if (hub) return ensureJoined(hub)
  if (await isUp(port)) return true

  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin.js")
  const child = spawn(process.execPath, [entry, "serve", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()

  process.stderr.write(dim("  starting kandy…\n"))
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await isUp(port)) return true
  }
  return false
}

/**
 * On a team: the hub must answer, and this machine's runner must be running.
 *
 * A note run from here goes to this machine's runner, and if that runner is
 * not running the note waits for a machine that never arrives. So it is
 * started the same way the local daemon is — detached, logging to a file —
 * and a command never has to be told "start your runner first".
 */
async function ensureJoined(hub: Joined): Promise<boolean> {
  try {
    await client().health()
  } catch {
    process.stderr.write(
      berry(`  cannot reach ${hub.url}`) +
        dim(" — is Tailscale up? (tailscale status)\n") +
        dim("  Your own board meanwhile: KANDY_LOCAL=1 kandy   ·   off the team for good: kandy leave\n"),
    )
    return false
  }
  if (!runnerPid()) startRunner()
  return true
}

/** Start this machine's runner in the background, for the joined hub. */
export function startRunner(): void {
  mkdirSync(path.dirname(RUNNER_LOG), { recursive: true })
  const log = openSync(RUNNER_LOG, "a")
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin.js")
  const child = spawn(process.execPath, [entry, "runner", "--json"], {
    detached: true,
    stdio: ["ignore", log, log],
  })
  child.unref()
}
