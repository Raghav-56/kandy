/**
 * Terminal client — status and attach, not a second full editor.
 *
 * Live, but still deliberately thin. It takes a snapshot of the board, then
 * folds the server's SSE stream into it with the *same* reducer the web app
 * and the server use, and redraws. That is the whole architecture: a TUI is a
 * rendering problem, not a second source of truth.
 *
 * Dependency-free on purpose — plain ANSI, no opentui yet (see docs/08-roadmap.md,
 * M3). Nothing here is load-bearing for that move: when the reconciler lands it
 * replaces `render()` and the event plumbing stays.
 *
 * Read-only for now. No raw mode, so ctrl-c is an ordinary SIGINT and the
 * terminal is always handed back intact.
 */
import { KandyClient } from "@kandy/client"
import { notesIn, reduce, type Board, type BoardView, type Note, type NoteStatus } from "@kandy/core"

const BASE = process.env["KANDY_URL"] ?? "http://127.0.0.1:4477"
/** Board id or name; without it the TUI attaches to the first board. */
const WANTED = process.env["KANDY_BOARD"]

// --- terminal ---------------------------------------------------------------

const ALT_ON = "\x1b[?1049h"
const ALT_OFF = "\x1b[?1049l"
const CURSOR_HIDE = "\x1b[?25l"
const CURSOR_SHOW = "\x1b[?25h"
const HOME = "\x1b[H"
/** Erase to end of line / end of screen — redraw without the full-clear flash. */
const EOL = "\x1b[K"
const EOS = "\x1b[0J"

const BOLD = 1
const DIM = 2
const INVERSE = 7

/**
 * DESIGN.md forbids colour, and that survives the port to a terminal: hierarchy
 * is weight and inversion, never hue. `blocked` is the only status that
 * legitimately demands attention, so it gets the loudest thing the palette has.
 */
const STATUS_SGR: Record<NoteStatus, number[]> = {
  draft: [],
  queued: [DIM],
  running: [BOLD],
  blocked: [INVERSE],
  review: [BOLD],
  done: [DIM],
  failed: [DIM],
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function sgr(text: string, codes: number[]): string {
  return codes.length === 0 ? text : `\x1b[${codes.join(";")}m${text}\x1b[0m`
}

/** Truncate on plain text, pad on plain text, style last — width stays honest. */
function cell(text: string, width: number, codes: number[] = []): string {
  const plain = text.length > width ? text.slice(0, Math.max(0, width - 1)) + "…" : text
  return sgr(plain.padEnd(width), codes)
}

// --- render -----------------------------------------------------------------

const GAP = 2
const MIN_COL = 18

type Frame = { view: BoardView; connected: boolean; tick: number }

function render({ view, connected, tick }: Frame): string {
  const width = process.stdout.columns ?? 80
  const height = process.stdout.rows ?? 24
  const lines: string[] = []

  const running = view.notes.filter((n) => n.status === "running").length
  const blocked = view.notes.filter((n) => n.status === "blocked").length
  const status = [
    blocked > 0 ? sgr(` ${blocked} blocked `, [INVERSE]) : null,
    running > 0 ? `${SPINNER[tick % SPINNER.length]} ${running} running` : null,
    connected ? sgr("live", [DIM]) : sgr("reconnecting…", [DIM]),
  ]
    .filter((s): s is string => s !== null)
    .join(sgr("  ·  ", [DIM]))

  lines.push("")
  lines.push("  " + sgr(view.board.name, [BOLD]) + "  " + sgr(view.board.repoPath, [DIM]))
  lines.push("  " + status)
  lines.push("")

  // Two lines of chrome at the top of each column, two reserved at the bottom.
  const body = Math.max(4, height - lines.length - 2)
  const columns = view.columns.map((c) => ({ name: c.name, notes: notesIn(view, c.id) }))

  const fits = Math.floor((width - 4 + GAP) / (MIN_COL + GAP))
  if (fits >= columns.length && columns.length > 0) {
    const colWidth = Math.floor((width - 4 - GAP * (columns.length - 1)) / columns.length)
    const rendered = columns.map((c) => column(c.name, c.notes, colWidth, body))
    for (let row = 0; row < body; row++) {
      const cells = rendered.map((r) => r[row] ?? " ".repeat(colWidth))
      lines.push("  " + cells.join(" ".repeat(GAP)))
    }
  } else {
    // Too narrow to be a board; be an honest list instead of a smeared one.
    for (const c of columns) {
      if (c.notes.length === 0) continue
      const left = body - (lines.length - 4)
      if (left < 4) break
      for (const line of column(c.name, c.notes, width - 4, left, false)) lines.push("  " + line)
      lines.push("")
    }
  }

  lines.push("")
  lines.push("  " + sgr("ctrl-c to quit", [DIM]))

  return HOME + lines.slice(0, height).join(EOL + "\n") + EOL + EOS
}

/**
 * One column as a fixed-width block of rows, clipped to `height`. Two rows per
 * note; when they don't all fit, one row goes to a truthful "+N more" rather
 * than letting the column lie by omission.
 */
function column(name: string, notes: Note[], width: number, height: number, pad = true): string[] {
  const rows: string[] = [
    cell(name.toUpperCase(), width, [BOLD]),
    cell("─".repeat(width), width, [DIM]),
  ]

  const room = Math.max(0, height - rows.length)
  const fitsAll = notes.length * 2 <= room
  const shown = fitsAll ? notes : notes.slice(0, Math.max(0, Math.floor((room - 1) / 2)))

  for (const n of shown) {
    rows.push(cell(`▌ ${n.title}`, width, STATUS_SGR[n.status]))
    const meta = [n.status, n.agent ? `@${n.agent}` : null, n.branch].filter(Boolean).join(" · ")
    rows.push(cell(`  ${meta}`, width, [DIM]))
  }
  if (shown.length < notes.length) {
    rows.push(cell(`  +${notes.length - shown.length} more`, width, [DIM]))
  }

  if (pad) while (rows.length < height) rows.push(" ".repeat(width))
  return rows.slice(0, height)
}

// --- SSE ---------------------------------------------------------------------

/**
 * A minimal `EventSource`, installed only when the runtime doesn't ship one
 * (Node still gates it behind --experimental-eventsource on the versions we
 * support). Inlined rather than imported: `--experimental-strip-types` doesn't
 * rewrite a `./x.js` specifier to the `.ts` on disk, so a second file would
 * break `pnpm dev` even though it typechecks.
 *
 * It exists so @kandy/client stays the single implementation of the wire
 * format — the TUI calls `client.events()` exactly like the browser does,
 * instead of growing a second SSE parser that can drift from it.
 *
 * Implements the slice of the spec the server actually uses: named events,
 * `id:` tracking, comment heartbeats, and reconnect with `Last-Event-ID` so a
 * dropped connection resumes the log rather than replaying it.
 */
type SseHandler = (ev: { data: string; lastEventId: string; type: string }) => void

const RETRY_MS = 1000

class NodeEventSource {
  onerror: ((e: unknown) => void) | null = null

  // No constructor parameter properties anywhere in this file: strip-types
  // rejects them as non-erasable syntax.
  private readonly url: string | URL
  private handlers = new Map<string, Set<SseHandler>>()
  private controller: AbortController | null = null
  private lastId = ""
  private closed = false

  constructor(url: string | URL) {
    this.url = url
    void this.loop()
  }

  addEventListener(type: string, handler: SseHandler): void {
    const set = this.handlers.get(type) ?? new Set<SseHandler>()
    set.add(handler)
    this.handlers.set(type, set)
  }

  removeEventListener(type: string, handler: SseHandler): void {
    this.handlers.get(type)?.delete(handler)
  }

  close(): void {
    this.closed = true
    this.controller?.abort()
  }

  private async loop(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connect()
      } catch (err) {
        if (this.closed) return
        this.onerror?.(err)
      }
      if (this.closed) return
      await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }

  private async connect(): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    const res = await fetch(this.url, {
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        ...(this.lastId ? { "last-event-id": this.lastId } : {}),
      },
    })
    if (!res.ok || !res.body) throw new Error(`sse: ${res.status} ${res.statusText}`)

    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      // Frames are separated by a blank line; keep the trailing partial.
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) this.dispatch(frame)
    }
    // The server ended the stream: fall back to the reconnect loop.
    throw new Error("sse: stream closed")
  }

  private dispatch(frame: string): void {
    let type = "message"
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line === "" || line.startsWith(":")) continue // heartbeat
      const colon = line.indexOf(":")
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
      if (field === "event") type = value
      else if (field === "data") data.push(value)
      else if (field === "id" && !value.includes("\0")) this.lastId = value
    }
    if (data.length === 0) return
    const ev = { data: data.join("\n"), lastEventId: this.lastId, type }
    for (const h of this.handlers.get(type) ?? []) h(ev)
  }
}

function installEventSource(): void {
  const g = globalThis as { EventSource?: unknown }
  if (typeof g.EventSource === "function") return
  g.EventSource = NodeEventSource
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  installEventSource()
  const client = new KandyClient({ baseUrl: BASE })
  const board = await waitForBoard(client)

  const view = await client.view(board.id)
  const frame: Frame = { view, connected: true, tick: 0 }

  // Coalesce: a burst of events (a run starting touches several) is one paint.
  let pending: NodeJS.Immediate | null = null
  const draw = () => {
    if (pending) return
    pending = setImmediate(() => {
      pending = null
      process.stdout.write(render(frame))
    })
  }

  enter()
  draw()

  const close = client.events(frame.view.seq, {
    onEvent: (e) => {
      // The stream replays from Last-Event-ID after a reconnect; anything the
      // snapshot already folded in is a no-op we can skip outright.
      if (e.seq <= frame.view.seq) return
      frame.connected = true
      frame.view = reduce(frame.view, e)
      draw()
    },
    onError: () => {
      // EventSource reconnects on its own; say so rather than exiting.
      frame.connected = false
      draw()
    },
  })

  // Motion is how a terminal shows liveness. Only spin when something is live.
  const beat = setInterval(() => {
    if (frame.view.notes.some((n) => n.status === "running")) {
      frame.tick++
      draw()
    }
  }, 120)

  process.stdout.on("resize", draw)

  const quit = () => {
    clearInterval(beat)
    close()
    leave()
    process.exit(0)
  }
  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
}

/**
 * A board may not exist yet — the server can be running while the user is still
 * in the web app creating one. Wait for it instead of exiting on an empty list.
 */
async function waitForBoard(client: KandyClient): Promise<Board> {
  let announced = false
  for (;;) {
    const { boards } = await client.boards()
    const board = WANTED
      ? boards.find((b) => b.id === WANTED || b.name === WANTED)
      : boards[0]
    if (board) return board
    if (!announced) {
      console.log(WANTED ? `waiting for board ${WANTED}…` : "no boards yet — waiting…")
      announced = true
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

let entered = false
function enter(): void {
  if (entered) return
  entered = true
  process.stdout.write(ALT_ON + CURSOR_HIDE)
}

/** Idempotent, and wired to every exit path: never hand back a broken terminal. */
function leave(): void {
  if (!entered) return
  entered = false
  process.stdout.write(CURSOR_SHOW + ALT_OFF)
}
process.on("exit", leave)

/**
 * Node reports a refused connection as a bare `TypeError: fetch failed`, with
 * the real reason buried in a `cause` chain (and sometimes an AggregateError,
 * one entry per address it tried). Dumping that at someone whose only mistake
 * was not starting the daemon is noise, so recognise it and say the fix.
 */
const OFFLINE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
])

function isOffline(err: unknown, depth = 0): boolean {
  if (depth > 4 || typeof err !== "object" || err === null) return false
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown }
  if (typeof e.code === "string" && OFFLINE_CODES.has(e.code)) return true
  if (Array.isArray(e.errors) && e.errors.some((inner) => isOffline(inner, depth + 1))) return true
  return isOffline(e.cause, depth + 1)
}

main().catch((err: unknown) => {
  leave()
  if (isOffline(err)) {
    console.error(`no kandy server at ${BASE} — start it with \`kandy serve\``)
  } else {
    console.error(err instanceof Error ? err.message : err)
  }
  process.exit(1)
})
