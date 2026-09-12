import type {
  BoardView,
  KandyEvent,
  PendingEvent,
  TranscriptFrame,
  TranscriptRole,
} from "@kandy/core"
import { Bus } from "./bus.js"
import { Projections } from "./projection.js"
import { Store } from "./store.js"

/**
 * The one place a state change happens.
 *
 * Append to the log, fold into the projections, publish to clients — in that
 * order, always. Having two call sites do this by hand is how a cache quietly
 * drifts from its log.
 */
export class Engine {
  readonly store: Store
  readonly bus: Bus
  readonly projections: Projections

  constructor(store = new Store(), bus = new Bus()) {
    this.store = store
    this.bus = bus
    this.projections = new Projections(store)
  }

  emit(pending: PendingEvent): KandyEvent {
    const e = this.store.append(pending)
    this.projections.apply(e)
    this.bus.publish(e)
    return e
  }

  /** Persist a transcript frame and push it to anyone watching, live. */
  say(runId: string, role: TranscriptRole, text: string, meta?: string): TranscriptFrame {
    const frame = this.store.appendTranscript(runId, role, text, meta)
    this.bus.publish(frame)
    return frame
  }

  /** Live-only "what this run is doing right now". Never logged. */
  activity(runId: string, tool: string, detail: string): void {
    this.bus.publish({ kind: "activity", runId, ts: Date.now(), tool, detail })
  }

  view(boardId: string): BoardView | null {
    return this.projections.view(boardId)
  }

  boardOf(noteId: string): BoardView | null {
    return this.projections.boardOf(noteId)
  }

  head(): number {
    return this.store.head()
  }

  close(): void {
    this.store.close()
  }
}
