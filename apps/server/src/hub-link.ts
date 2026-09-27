import { SseDecoder } from "@kandy/client"
import {
  COMMAND_EVENT,
  EVENT_TYPES,
  type Command,
  type Hello,
  type HelloReply,
  type KandyEvent,
  type LogOp,
  type TranscriptFrame,
} from "@kandy/core"
import type { RemoteLog } from "./remote-log.js"

/**
 * A runner's one connection to its hub, from the runner's side.
 *
 * Everything goes out from here — hello, the stream, the log, replies — so a
 * machine running agents never listens on a port. The hub cannot reach in;
 * it can only answer, and put commands on a stream the runner chose to open.
 */

/** Something the hub may ask for, by name. Every argument and result is plain data. */
export type Handlers = Record<string, (...args: never[]) => Promise<unknown>>

/** Three of the hub's 15-second keep-alives. */
const SILENCE_MS = 45_000
/** Well inside the hub's one-minute limit for a silent runner. */
const CHECK_IN_MS = 20_000

export class HubLink {
  private stopped = false
  private controller: AbortController | null = null
  /** Resolved once the replica has caught up with the hub for the first time. */
  readonly ready: Promise<void>
  private markReady!: () => void
  owner: string | null = null

  constructor(
    private readonly opts: {
      hub: string
      /** How this runner proves who it is: a bearer on one machine, Tailscale's headers across a tailnet. */
      headers: Record<string, string>
      hello: () => Hello | Promise<Hello>
      handlers: Handlers
      log: RemoteLog
      onStatus?: (s: "online" | "offline", why?: string) => void
      /** How long the stream may say nothing before it's treated as dead. */
      silenceMs?: number
      /** How often to tell the hub this runner is still here. */
      checkInMs?: number
    },
  ) {
    this.ready = new Promise((r) => (this.markReady = r))
  }

  /** Say hello and hold the stream open, reconnecting for as long as the runner runs. */
  async start(): Promise<void> {
    let delay = 500
    while (!this.stopped) {
      try {
        const reply = await this.post<HelloReply>("/runner/hello", await this.opts.hello())
        this.owner = reply.owner
        await this.stream()
        delay = 500
      } catch (err) {
        if (this.stopped) return
        this.opts.onStatus?.("offline", err instanceof Error ? err.message : String(err))
      }
      if (this.stopped) return
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 10_000)
    }
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
  }

  /** The writes `RemoteLog` batches up. */
  sendLog = async (ops: LogOp[]): Promise<void> => {
    await this.post("/runner/log", { runnerId: (await this.opts.hello()).runnerId, ops })
  }

  /** A past run's whole transcript, page by page, over the ordinary route. */
  history = async (runId: string): Promise<TranscriptFrame[]> => {
    const frames: TranscriptFrame[] = []
    let after = 0
    for (;;) {
      const page = await this.get<{ frames: TranscriptFrame[]; nextAfter: number | null }>(
        `/runs/${encodeURIComponent(runId)}/transcript?after=${after}`,
      )
      frames.push(...page.frames)
      if (page.nextAfter === null || page.frames.length === 0) return frames
      after = page.nextAfter
    }
  }

  // ── the stream ──────────────────────────────────────────────────────────

  private async stream(): Promise<void> {
    const { runnerId } = await this.opts.hello()
    this.controller = new AbortController()
    const url = `${this.opts.hub}/runner/stream?runner=${encodeURIComponent(runnerId)}&after=${this.opts.log.head}`
    const res = await fetch(url, {
      signal: this.controller.signal,
      headers: { ...this.opts.headers, accept: "text/event-stream" },
    })
    if (!res.ok || !res.body) throw new Error(`stream refused: ${res.status} ${await res.text().catch(() => "")}`)
    this.opts.onStatus?.("online")

    /*
     * A connection can die without closing: Wi-Fi drops, a laptop sleeps, a
     * proxy loses its upstream. The stream then just goes quiet, the loop in
     * start() never learns it should reconnect, and the machine sits "online"
     * doing nothing. The hub sends a keep-alive every 15s, so three missed
     * beats means nobody is there.
     */
    const controller = this.controller
    let quiet: ReturnType<typeof setTimeout> | undefined
    const listen = () => {
      clearTimeout(quiet)
      quiet = setTimeout(() => controller.abort(new Error("the hub went quiet")), this.opts.silenceMs ?? SILENCE_MS)
    }
    listen()
    // The other direction: tell the hub we're here, so a runner that dies
    // without closing its connection doesn't stay "online" there.
    const checkIn = setInterval(() => void this.sendLog([]).catch(() => {}), this.opts.checkInMs ?? CHECK_IN_MS)

    const decoder = new SseDecoder()
    const text = new TextDecoder()
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        listen()
        for (const msg of decoder.push(text.decode(chunk, { stream: true }))) {
          if (msg.type === COMMAND_EVENT) {
            void this.run(JSON.parse(msg.data) as Command)
          } else if (msg.type === "caught-up") {
            // The hub has replayed everything this runner missed. Until now the
            // replica was a board from the past, and deciding anything by it
            // would have been deciding by something already untrue.
            this.markReady()
          } else if (DOMAIN.has(msg.type)) {
            this.opts.log.receive(JSON.parse(msg.data) as KandyEvent)
          }
          // Transcript and activity frames are for people watching. A runner
          // wrote them and has no use for them back.
        }
      }
    } finally {
      clearTimeout(quiet)
      clearInterval(checkIn)
    }
    throw new Error("stream closed")
  }

  /** Answer one command, exactly once, whatever happens. */
  private async run(cmd: Command): Promise<void> {
    const { runnerId } = await this.opts.hello()
    const fn = this.opts.handlers[cmd.op] as ((...args: unknown[]) => Promise<unknown>) | undefined
    let reply: unknown
    if (!fn) {
      reply = { runnerId, id: cmd.id, ok: false, error: `this runner cannot ${cmd.op}`, status: 501 }
    } else {
      try {
        // Let the writes this command's work caused reach the hub first, so
        // a caller who acts on the reply sees what the command did.
        const result = await fn(...cmd.args)
        await this.opts.log.flush()
        reply = { runnerId, id: cmd.id, ok: true, result: result ?? null }
      } catch (err) {
        const e = err as { message?: string; status?: number; code?: string }
        reply = {
          runnerId,
          id: cmd.id,
          ok: false,
          error: e.message ?? String(err),
          ...(typeof e.status === "number" ? { status: e.status } : {}),
          ...(e.code ? { code: e.code } : {}),
        }
      }
    }
    await this.post("/runner/reply", reply).catch((err) => {
      this.opts.onStatus?.("offline", `could not answer ${cmd.op}: ${err}`)
    })
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.opts.hub + path, {
      method: "POST",
      headers: { ...this.opts.headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as T & { error?: { message?: string } }
    if (!res.ok) throw new Error(json?.error?.message ?? `${path}: ${res.status}`)
    return json
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.opts.hub + path, { headers: this.opts.headers })
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    return (await res.json()) as T
  }
}

const DOMAIN = new Set<string>(EVENT_TYPES)
