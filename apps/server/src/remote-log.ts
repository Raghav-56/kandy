import type {
  BoardView,
  KandyEvent,
  Log,
  LogOp,
  PendingEvent,
  TranscriptFrame,
  TranscriptRole,
} from "@kandy/core"
import { Projections } from "./projection.js"

/**
 * The log, for a runner whose hub is somewhere else.
 *
 * Writes are queued and posted in ordered batches; reads come from a replica
 * folded from the hub's event stream, by the same `Projections` the hub uses,
 * so the board a runner decides by is folded by exactly the code that folds
 * the hub's.
 *
 * ## Read-your-own-writes
 *
 * The runner emits an event and then reads the board expecting to see it —
 * `run.requested`, then a `start()` that looks the run up. Against a local
 * engine that is instant. Against a hub the event comes back only after it
 * has been stamped and streamed, and a runner that looked in between would
 * see a board where its own run does not exist yet.
 *
 * So an emit is applied to the replica at once, and its echo is skipped when
 * it arrives. Matched in order, by content: the hub appends a runner's batches
 * in the order they were sent and streams them in the order it appended them,
 * so this runner's echoes arrive in the order they were written, interleaved
 * with other people's events but never reordered among themselves.
 *
 * A write the hub refuses leaves the replica ahead of the truth. That only
 * happens to a runner that is misbehaving or confused, and the answer is the
 * blunt one: `resync`, which throws the replica away and rebuilds it.
 */
export class RemoteLog implements Log {
  replica = new Projections()
  private queue: LogOp[] = []
  /** Emits applied locally whose echo has not come back yet, oldest first. */
  private ahead: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> | null = null
  /** The last seq folded in, which is where a reconnect resumes from. */
  head = 0
  private listeners = new Set<(e: KandyEvent) => void>()

  /** Every event from the hub, after it is folded. For a runner that must react — a new board, say. */
  onEvent(fn: (e: KandyEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  constructor(
    private readonly send: (ops: LogOp[]) => Promise<void>,
    private readonly fetchHistory: (runId: string) => Promise<TranscriptFrame[]>,
    /** How long a write may wait for company before it is sent alone. */
    private readonly batchMs = 30,
  ) {}

  // ── writes ──────────────────────────────────────────────────────────────

  emit(pending: PendingEvent): void {
    // Stamped provisionally so the replica can fold it. The hub's own stamp
    // replaces nothing here: the echo is skipped, and `head` only ever moves
    // on events that came from the hub.
    this.replica.apply({ ...pending, seq: this.head, ts: Date.now(), actor: null } as KandyEvent)
    this.ahead.push(key(pending))
    this.push({ op: "emit", pending })
  }

  say(runId: string, role: TranscriptRole, text: string, meta?: string): void {
    this.push({ op: "say", runId, role, text, ...(meta !== undefined ? { meta } : {}) })
  }

  activity(runId: string, tool: string, detail: string): void {
    this.push({ op: "activity", runId, tool, detail })
  }

  output(runId: string, channel: "stdout" | "stderr", text: string): void {
    this.push({ op: "output", runId, channel, text })
  }

  saveDiff(
    noteId: string,
    snapshot: { runId: string; branch: string; stat: string; diff: string },
  ): void {
    this.push({ op: "saveDiff", noteId, snapshot })
  }

  // ── reads ───────────────────────────────────────────────────────────────

  view(boardId: string): BoardView | null {
    return this.replica.view(boardId)
  }

  history(runId: string): Promise<TranscriptFrame[]> {
    return this.fetchHistory(runId)
  }

  // ── the stream ──────────────────────────────────────────────────────────

  /**
   * An event from the hub. Folded unless it is the echo of one of ours, which
   * was folded when it was written.
   */
  receive(e: KandyEvent): void {
    this.head = Math.max(this.head, e.seq)
    if (this.ahead.length && this.ahead[0] === key(e)) {
      this.ahead.shift()
      return
    }
    this.replica.apply(e)
    for (const fn of this.listeners) fn(e)
  }

  /** Start again from a known-good board, discarding anything optimistic. */
  resync(events: KandyEvent[]): void {
    this.replica = new Projections()
    this.ahead = []
    this.head = 0
    for (const e of events) this.receive(e)
  }

  // ── sending ─────────────────────────────────────────────────────────────

  private push(op: LogOp): void {
    this.queue.push(op)
    // A burst of output is sent as one request; a lone write waits a few
    // milliseconds for company and then goes anyway.
    if (this.queue.length >= 200) void this.flush()
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.batchMs)
  }

  /**
   * Send everything queued, in order, one batch at a time.
   *
   * A failed send puts its batch back at the front and tries again, so a hub
   * that restarts mid-run loses nothing and reorders nothing; the runner's
   * process holds the writes until there is somewhere to put them.
   */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.flushing) return this.flushing.then(() => (this.queue.length ? this.flush() : undefined))
    if (this.queue.length === 0) return Promise.resolve()

    const batch = this.queue.splice(0, this.queue.length)
    this.flushing = (async () => {
      let delay = 250
      for (;;) {
        try {
          await this.send(batch)
          return
        } catch {
          await new Promise((r) => setTimeout(r, delay))
          delay = Math.min(delay * 2, 5000)
        }
      }
    })().finally(() => {
      this.flushing = null
      if (this.queue.length && !this.timer) this.timer = setTimeout(() => void this.flush(), 0)
    })
    return this.flushing
  }

  /** Everything written so far has reached the hub. For shutdown, and for tests. */
  async drain(): Promise<void> {
    while (this.queue.length || this.flushing) await this.flush()
  }
}

function key(e: { type: string; data: unknown }): string {
  return e.type + "\0" + JSON.stringify(e.data)
}
