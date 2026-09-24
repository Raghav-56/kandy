import type {
  ActorId,
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

  /**
   * `actor` is who asked for this, where that is known.
   *
   * Stamped here rather than carried on the pending event, for the same
   * reason `seq` is: once a runner on someone else's machine can append to a
   * hub's log, an actor inside the payload would be one the sender chose for
   * themselves. The caller reads it off an authenticated connection and
   * passes it in; nothing trusts a claim in the message.
   */
  emit(pending: PendingEvent, actor: ActorId | null = null): KandyEvent {
    const e = this.store.append(pending, Date.now(), actor)
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
