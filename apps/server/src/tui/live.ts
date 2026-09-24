/**
 * Snapshot, then stream — the web app's `useBoard`, outside React.
 *
 * The reducer is `reduce` from @kandy/core, the same one the server projects
 * with and the web app renders with. Events at or below the snapshot's seq are
 * skipped, exactly as there.
 *
 * The difference is batching. A run in full flow emits many transcript frames
 * a second; repainting a terminal for each would flicker and burn CPU. So
 * everything the stream delivers is queued and folded in at most once per
 * frame (`intervalMs`, ~30fps), and subscribers hear about it once.
 */
import type { KandyClient } from "@kandy/client"
import { reduce, type ActivityFrame, type BoardView, type KandyEvent, type TranscriptFrame } from "@kandy/core"
import { mergeFrames } from "./transcript.js"

export type LiveClient = Pick<KandyClient, "view" | "events" | "transcript">

export type LiveState = {
  boardId: string | null
  view: BoardView | null
  connected: boolean
  error: string | null
  /** Transcript per run, ordered by seq. */
  transcripts: Readonly<Record<string, readonly TranscriptFrame[]>>
  /** What each run is doing right now. Live-only. */
  activity: Readonly<Record<string, ActivityFrame>>
}

const EMPTY: LiveState = { boardId: null, view: null, connected: false, error: null, transcripts: {}, activity: {} }

export type Timers = {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Coalesce calls: the first `schedule()` arms one timer; everything until it
 * fires rides along. `flushNow()` runs it immediately (tests, teardown).
 */
export function batcher(flush: () => void, ms: number, timers: Timers = realTimers) {
  let handle: unknown = null
  return {
    schedule() {
      if (handle !== null) return
      handle = timers.set(() => {
        handle = null
        flush()
      }, ms)
    },
    flushNow() {
      if (handle !== null) {
        timers.clear(handle)
        handle = null
      }
      flush()
    },
    cancel() {
      if (handle !== null) timers.clear(handle)
      handle = null
    },
    get pending() {
      return handle !== null
    },
  }
}

export class LiveBoard {
  private state: LiveState = EMPTY
  private listeners = new Set<() => void>()
  private close: (() => void) | undefined
  /** The live seq, ahead of `state.view.seq` while events wait in the queue. */
  private seq = 0
  private generation = 0
  private events: KandyEvent[] = []
  private frames = new Map<string, TranscriptFrame[]>()
  private acts = new Map<string, ActivityFrame>()
  private connection: boolean | null = null
  private fetched = new Set<string>()
  private batch: ReturnType<typeof batcher>

  constructor(
    private client: LiveClient,
    opts: { intervalMs?: number; timers?: Timers } = {},
  ) {
    this.batch = batcher(() => this.flush(), opts.intervalMs ?? 33, opts.timers)
  }

  getSnapshot = (): LiveState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(next: LiveState): void {
    this.state = next
    for (const fn of this.listeners) fn()
  }

  /** Load a board's snapshot and stream from it. Replaces whatever was open. */
  async open(boardId: string): Promise<void> {
    this.stop()
    const gen = ++this.generation
    this.fetched.clear()
    this.set({ ...EMPTY, boardId })
    try {
      const snapshot = await this.client.view(boardId)
      if (gen !== this.generation) return
      this.seq = snapshot.seq
      this.set({ ...this.state, view: snapshot, error: null })
      this.close = this.client.events(snapshot.seq, {
        onEvent: (e) => {
          if (gen !== this.generation) return
          // Skip anything already folded into the snapshot (or already seen).
          if (e.seq <= this.seq) return
          this.seq = e.seq
          this.events.push(e)
          this.connection = true
          this.batch.schedule()
        },
        onError: () => {
          if (gen !== this.generation) return
          this.connection = false
          this.batch.schedule()
        },
        onTranscript: (f) => {
          if (gen !== this.generation) return
          const list = this.frames.get(f.runId)
          if (list) list.push(f)
          else this.frames.set(f.runId, [f])
          this.connection = true
          this.batch.schedule()
        },
        onActivity: (f) => {
          if (gen !== this.generation) return
          this.acts.set(f.runId, f)
          this.batch.schedule()
        },
      })
      this.set({ ...this.state, connected: true })
    } catch (err) {
      if (gen !== this.generation) return
      this.set({ ...this.state, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Fold everything queued into one new state and notify once. */
  flush(): void {
    const s = this.state
    let view = s.view
    for (const e of this.events) if (view) view = reduce(view, e)
    this.events = []

    let transcripts = s.transcripts
    if (this.frames.size > 0) {
      const next = { ...transcripts }
      for (const [runId, list] of this.frames) next[runId] = mergeFrames(next[runId] ?? [], list)
      this.frames.clear()
      transcripts = next
    }
    let activity = s.activity
    if (this.acts.size > 0) {
      activity = { ...activity, ...Object.fromEntries(this.acts) }
      this.acts.clear()
    }
    const connected = this.connection ?? s.connected
    this.connection = null
    if (view === s.view && transcripts === s.transcripts && activity === s.activity && connected === s.connected) return
    this.set({ ...s, view, transcripts, activity, connected })
  }

  /**
   * Backfill a run's transcript from disk, once. Paged; merged with whatever
   * the stream has already delivered so nothing blanks or duplicates.
   */
  async loadTranscript(runId: string, maxPages = 20): Promise<void> {
    if (this.fetched.has(runId)) return
    this.fetched.add(runId)
    const gen = this.generation
    try {
      let after = 0
      let all: TranscriptFrame[] = []
      for (let page = 0; page < maxPages; page++) {
        const { frames, nextAfter } = await this.client.transcript(runId, after)
        all = all.concat(frames)
        if (nextAfter === null || nextAfter <= after) break
        after = nextAfter
      }
      if (gen !== this.generation) return
      const have = this.state.transcripts[runId] ?? []
      this.set({ ...this.state, transcripts: { ...this.state.transcripts, [runId]: mergeFrames(have, all) } })
    } catch {
      // A note that never ran has no transcript; allow a retry after a blip.
      this.fetched.delete(runId)
    }
  }

  private stop(): void {
    this.close?.()
    this.close = undefined
    this.batch.cancel()
    this.events = []
    this.frames.clear()
    this.acts.clear()
    this.connection = null
  }

  dispose(): void {
    this.generation++
    this.stop()
    this.listeners.clear()
  }
}
