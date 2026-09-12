import type { KandyEvent } from "@kandy/core"

type Listener = (e: KandyEvent) => void

/** In-process fan-out from the log to every connected SSE stream. */
export class Bus {
  private listeners = new Set<Listener>()

  publish(e: KandyEvent): void {
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
