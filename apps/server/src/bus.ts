import type { StreamFrame } from "@kandy/core"

type Listener = (e: StreamFrame) => void

/**
 * In-process fan-out to every connected SSE stream.
 *
 * Carries two kinds of frame: durable domain events from the log, and
 * ephemeral transcript frames. Both go down the same wire; only the former
 * gets an SSE `id:`, so a reconnect resumes the log without replaying
 * megabytes of agent chatter. See TranscriptFrame in @kandy/core.
 */
export class Bus {
  private listeners = new Set<Listener>()

  publish(e: StreamFrame): void {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch (err) {
        // One bad subscriber must never stop delivery to the others, and must
        // never take down a run that is mid-flight.
        console.error("[bus] listener threw:", err)
      }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
