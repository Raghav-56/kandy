/**
 * A minimal `EventSource` for runtimes that don't ship one, and the frame
 * decoder underneath it.
 *
 * Node has no global EventSource on the versions we support, so
 * `new EventSource(url)` throws in every CLI context — the TUI, `kandy log`,
 * anything else that wants the live stream. The browser has had one for years.
 *
 * This lives in @kandy/client, beside the only code that constructs an
 * EventSource, so there is one implementation of the wire format rather than
 * one per consumer. Callers don't install it themselves: `KandyClient.events`
 * does, and `installEventSource` is a no-op where a real one exists.
 *
 * Implements the slice of the spec the server actually uses: named events,
 * `id:` tracking, comment heartbeats, and reconnect with `Last-Event-ID` so a
 * dropped connection resumes the log rather than replaying it.
 */

export type SseMessage = {
  /** The `event:` name, or "message" when the frame doesn't name one. */
  type: string
  /** `data:` lines joined with newlines, per the spec. */
  data: string
  /** The most recent `id:` seen on the stream, not just on this frame. */
  lastEventId: string
}

const RETRY_MS = 1000

/**
 * Turns a byte stream into frames.
 *
 * Split out from the transport because this is the part with the bug in it:
 * frames arrive split across chunk boundaries as a matter of course, and a
 * decoder that assumes one chunk is one frame works in every test and fails
 * against a real server. Keeping it separate means it can be tested without a
 * socket.
 */
export class SseDecoder {
  private buffer = ""
  private lastId = ""

  /** Feed a chunk; get back whatever frames completed. Partials are held. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk
    const parts = this.buffer.split("\n\n")
    // The trailing element is either "" (the chunk ended on a boundary) or the
    // start of a frame we haven't finished receiving. Either way it is not ours
    // to dispatch yet.
    this.buffer = parts.pop() ?? ""
    const out: SseMessage[] = []
    for (const frame of parts) {
      const msg = this.decode(frame)
      if (msg) out.push(msg)
    }
    return out
  }

  private decode(frame: string): SseMessage | null {
    let type = "message"
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line === "" || line.startsWith(":")) continue // heartbeat or blank
      const colon = line.indexOf(":")
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
      if (field === "event") type = value
      else if (field === "data") data.push(value)
      else if (field === "id" && !value.includes("\0")) this.lastId = value
    }
    // A frame carrying only an id or a comment is legal and means nothing to a
    // listener. Dropping it here keeps that out of every handler.
    if (data.length === 0) return null
    return { type, data: data.join("\n"), lastEventId: this.lastId }
  }

  /** What to send as `Last-Event-ID` when reconnecting. */
  get resumeFrom(): string {
    return this.lastId
  }
}

type SseHandler = (ev: SseMessage) => void

export class NodeEventSource {
  onerror: ((e: unknown) => void) | null = null

  private readonly url: string | URL
  private handlers = new Map<string, Set<SseHandler>>()
  private decoder = new SseDecoder()
  private controller: AbortController | null = null
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
    // The decoder carries the resume point across reconnects; the buffer does
    // not, since a half-frame from a dead connection will never be completed.
    const resume = this.decoder.resumeFrom
    this.decoder = new SseDecoder()
    const res = await fetch(this.url, {
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        ...(resume ? { "last-event-id": resume } : {}),
      },
    })
    if (!res.ok || !res.body) throw new Error(`sse: ${res.status} ${res.statusText}`)

    const textDecoder = new TextDecoder()
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const msg of this.decoder.push(textDecoder.decode(chunk, { stream: true }))) {
        for (const h of this.handlers.get(msg.type) ?? []) h(msg)
      }
    }
    // The server ended the stream: fall back to the reconnect loop.
    throw new Error("sse: stream closed")
  }
}

/** Install the polyfill, unless the runtime already has the real thing. */
export function installEventSource(): void {
  const g = globalThis as { EventSource?: unknown }
  if (typeof g.EventSource === "function") return
  g.EventSource = NodeEventSource
}
