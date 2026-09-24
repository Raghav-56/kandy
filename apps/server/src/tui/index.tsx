/**
 * `kandy tui` — the board in a terminal.
 *
 * Full-screen (alternate buffer), keyboard-first, live. The snapshot-then-
 * stream plumbing is `LiveBoard`; the screens are `App`. This file owns the
 * terminal: entering it, and handing it back intact on every way out —
 * quitting, SIGINT/SIGTERM, or a crash.
 */
import type { KandyClient } from "@kandy/client"
import { render } from "ink"
import { App } from "./app.js"
import { LiveBoard } from "./live.js"

export type TuiOptions = { client: KandyClient; boardId?: string | null; hub?: boolean }

export async function runTui(opts: TuiOptions): Promise<void> {
  const { client } = opts
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("kandy tui needs an interactive terminal")
  }

  // Resolve the board before taking over the screen, so a bad id or a daemon
  // that isn't running is an ordinary error message, not a flash of UI.
  const { boards } = await client.boards()
  let boardId: string | null = null
  if (opts.boardId) {
    const b = boards.find((x) => x.id === opts.boardId || x.name === opts.boardId)
    if (!b) throw new Error(`no board "${opts.boardId}" — boards: ${boards.map((x) => x.name).join(", ") || "none"}`)
    boardId = b.id
  } else {
    boardId = boards[0]?.id ?? null
  }

  const live = new LiveBoard(client)

  // Anything printed while the screen is ours would tear the frame. Route it
  // to the footer instead (the SSE polyfill logs bad payloads, for one).
  let sink: ((text: string) => void) | null = null
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
  const capture = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : safeJson(a))).join(" ")
    sink?.(text)
  }
  console.log = console.info = console.warn = console.error = console.debug = capture

  let crash: unknown = null
  const instance = render(
    <App
      client={client}
      live={live}
      boards={boards}
      boardId={boardId}
      hub={opts.hub}
      onLog={(fn) => {
        sink = fn
      }}
    />,
    {
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 30,
      incrementalRendering: true,
    },
  )

  const quit = () => instance.unmount()
  const onCrash = (err: unknown) => {
    crash ??= err
    instance.unmount()
  }
  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
  process.on("SIGHUP", quit)
  process.on("uncaughtException", onCrash)
  process.on("unhandledRejection", onCrash)

  try {
    await instance.waitUntilExit()
  } catch (err) {
    crash ??= err
  } finally {
    process.off("SIGINT", quit)
    process.off("SIGTERM", quit)
    process.off("SIGHUP", quit)
    process.off("uncaughtException", onCrash)
    process.off("unhandledRejection", onCrash)
    live.dispose()
    Object.assign(console, original)
    // Belt and braces: cursor visible, alternate screen left, raw mode off.
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdout.write("\x1b[?25h")
    process.stdin.pause()
  }
  if (crash) throw crash
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
