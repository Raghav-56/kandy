/**
 * A minimal `EventSource` for Node, installed only when the runtime doesn't
 * ship one (it is still flag-gated on the Node versions we support).
 *
 * This exists so @kandy/client stays the single implementation of the wire
 * format — the TUI gets to call `client.events()` exactly like the browser
 * does, instead of growing a second SSE parser that can drift from it.
 *
 * Implements the slice of the spec the server actually uses: named events,
 * `id:` tracking, comment heartbeats, and reconnect with `Last-Event-ID` so a
 * dropped connection resumes the log rather than replaying it.
 */
type Handler = (ev: { data: string; lastEventId: string; type: string }) => void

const RETRY_MS = 1000

class NodeEventSource {
  onerror: ((e: unknown) => void) | null = null

  private handlers = new Map<string, Set<Handler>>()
  private controller: AbortController | null = null
  private lastId = ""
  private closed = false

  constructor(private readonly url: string | URL) {
    void this.loop()
  }

  addEventListener(type: string, handler: Handler): void {
    const set = this.handlers.get(type) ?? new Set<Handler>()
    set.add(handler)
    this.handlers.set(type, set)
  }

  removeEventListener(type: string, handler: Handler): void {
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

export function installEventSource(): void {
  const g = globalThis as { EventSource?: unknown }
  if (typeof g.EventSource === "function") return
  g.EventSource = NodeEventSource
}
