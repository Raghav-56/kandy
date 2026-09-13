import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { KandyClient } from "@kandy/client"
import { dim } from "./banner.js"

import { readToken } from "../auth.js"
import { TOKEN_PATH } from "../paths.js"

export const DEFAULT_PORT = 4477

export function client(port = DEFAULT_PORT): KandyClient {
  return new KandyClient({ baseUrl: `http://127.0.0.1:${port}`, token: () => readToken(TOKEN_PATH) })
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
  if (await isUp(port)) return true

  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cli.js")
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
