import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { KandyClient } from "@kandy/client"
import { berry, dim } from "./banner.js"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs"
import { joinedHub, RUNNER_LOG, runnerPid, type Joined } from "../joined.js"

import { readToken } from "../auth.js"
import { STATE_DIR, TOKEN_PATH } from "../paths.js"
import { portOwner } from "../port.js"

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

/** Where a daemon started in the background writes what it says. */
export const DAEMON_LOG = path.join(STATE_DIR, "daemon.log")

/** Settings for a daemon this command has to start: only `--slots`, so far. */
let startSlots: number | undefined
export function startWith(opts: { slots?: number }): void {
  startSlots = opts.slots
}

/**
 * Start the daemon if it isn't already running.
 *
 * Every other command needs it, and "start the server first" is a chore the
 * tool can do itself. Detached, so the shell that happened to run `kandy new`
 * isn't the thing keeping your agents alive — and logging to a file, because a
 * daemon that died on start with its output thrown away left nothing to go on
 * but "could not reach the kandy daemon".
 *
 * Says why when it fails, so a caller need only return.
 */
export async function ensureUp(port = DEFAULT_PORT): Promise<boolean> {
  const hub = hubFor(port)
  if (hub) return ensureJoined(hub)
  if (await isUp(port)) {
    if (startSlots !== undefined) {
      process.stderr.write(
        dim("  kandy is already running, so --slots changes nothing — kandy stop, then run this again\n"),
      )
    }
    return true
  }

  // Waiting fifteen seconds on a port someone else has is waiting for nothing.
  const owner = await portOwner(port)
  if (owner && !owner.kandy) {
    process.stderr.write(
      berry(`  port ${port} is held by something that is not kandy\n`) +
        dim(`  stop that, or use another port: --port ${port + 1}\n`),
    )
    return false
  }

  mkdirSync(path.dirname(DAEMON_LOG), { recursive: true })
  // Only what this start says is shown if it fails; the file keeps the rest.
  const from = existsSync(DAEMON_LOG) ? statSync(DAEMON_LOG).size : 0
  const log = openSync(DAEMON_LOG, "a")
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin.js")
  const args = [entry, "serve", "--port", String(port), ...(startSlots !== undefined ? ["--slots", String(startSlots)] : [])]
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  })
  let exited = false
  child.on("exit", () => {
    exited = true
  })
  child.unref()
  closeSync(log)

  process.stderr.write(dim("  starting kandy…\n"))
  for (let i = 0; i < 60 && !exited; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await isUp(port)) return true
  }

  process.stderr.write(berry(exited ? "  kandy stopped as it started\n" : "  kandy did not start within 15 seconds\n"))
  for (const line of tailOf(DAEMON_LOG, from, 12)) process.stderr.write(dim(`    ${line}\n`))
  process.stderr.write(dim(`  the whole log: ${DAEMON_LOG}\n`))
  process.stderr.write(dim(`  to watch it start: kandy serve --port ${port}\n`))
  return false
}

/** The last `n` non-empty lines written to a file since byte `from`. */
export function tailOf(file: string, from: number, n: number): string[] {
  try {
    const text = readFileSync(file).subarray(from).toString("utf8")
    // Colour codes are for a terminal; these lines are quoted inside another.
    return text
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.trim())
      .slice(-n)
  } catch {
    return []
  }
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
        // Either end can be the one that's off: this machine's Tailscale, or
        // the hub's machine — `tailscale status` shows both.
        dim(/\.ts\.net(:\d+)?(\/|$)/i.test(hub.url.replace(/^https?:\/\//, "")) ? " — is Tailscale up here, and is the hub's machine on? (tailscale status)\n" : " — is the hub running?\n") +
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
    windowsHide: true,
  })
  child.unref()
}
