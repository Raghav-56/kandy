import { daemonToken } from "@/lib/daemon-token"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KandyClient, KandyError } from "@kandy/client"
import {
  reduce,
  type ActivityFrame,
  type BoardView,
  type KandyEvent,
  type TranscriptFrame,
} from "@kandy/core"
import { isUnreachable, UNREACHABLE } from "@/hooks/useDaemon"

/** How many attributed events the Team page's activity list keeps. */
const RECENT = 50

/** Live frames kept for a run nobody has opened. */
const LIVE_TAIL = 400

/**
 * Snapshot, then stream. The reducer is the one in @kandy/core — the same code
 * the server projects with and the TUI will render with.
 */
export function useBoard(
  boardId: string | null,
  opts: {
    hub?: boolean
    /** Bumped when the daemon comes back; everything is fetched afresh. */
    epoch?: number
    /** Told when a request or the stream finds nothing answering. */
    onUnreachable?: () => void
  } = {},
) {
  const hub = opts.hub ?? false
  const epoch = opts.epoch ?? 0
  // A ref, so a new callback identity never tears down the stream.
  const unreachable = useRef(opts.onUnreachable)
  unreachable.current = opts.onUnreachable
  const client = useMemo(() => new KandyClient({ baseUrl: "/api", token: daemonToken }), [])
  const [view, setView] = useState<BoardView | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Live transcript, keyed by run. Bounded — see below. */
  const [transcript, setTranscript] = useState<Record<string, TranscriptFrame[]>>({})
  /** What each run is doing right now. Live-only; empty after a reconnect. */
  const [activity, setActivity] = useState<Record<string, ActivityFrame>>({})
  /**
   * The last few events someone can be named for, newest first.
   *
   * A ring rather than the whole log: the Team page shows thirty lines, and
   * the stream never ends.
   */
  const [recent, setRecent] = useState<KandyEvent[]>([])

  // The stream must not be torn down and rebuilt every time the view updates,
  // so the live seq lives in a ref rather than the effect's dependencies.
  const seq = useRef(0)

  useEffect(() => {
    if (!boardId) return
    let cancelled = false
    let close: (() => void) | undefined

    setTranscript({})
    setActivity({})
    setRecent([])
    fetched.current.clear()
    client
      .view(boardId)
      .then((snapshot) => {
        if (cancelled) return
        setView(snapshot)
        seq.current = snapshot.seq
        // Whatever went wrong before this snapshot — the daemon being gone
        // included — is over.
        setError(null)

        // History from `/activity`; everything after the snapshot from the stream.
        if (hub) {
          void client
            .activity(RECENT)
            .then(({ events }) => !cancelled && setRecent((r) => merge(r, events)))
            .catch(() => {})
        }
        close = client.events(snapshot.seq, {
          onEvent: (e) => {
            if (e.actor) setRecent((r) => merge(r, [e]))
            // Skip anything already folded into the snapshot.
            if (e.seq <= seq.current) return
            seq.current = e.seq
            setView((v) => (v ? reduce(v, e) : v))
          },
          onError: () => {
            setConnected(false)
            unreachable.current?.()
          },
          onTranscript: (frame) => {
            setTranscript((t) => {
              const prev = t[frame.runId] ?? []
              if (prev.some((f) => f.seq === frame.seq)) return t
              // An agent can talk for a long time. Keep the tail of runs no
              // one is reading; the full record is on disk and one fetch away.
              // A run someone opened keeps everything, or the backfill it
              // fetched would be trimmed away again frame by frame.
              const next = [...prev, frame]
              const keep = fetched.current.has(frame.runId) ? next : next.slice(-LIVE_TAIL)
              return { ...t, [frame.runId]: keep }
            })
          },
          onActivity: (frame) => setActivity((a) => ({ ...a, [frame.runId]: frame })),
        })
        setConnected(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // The board list says a board is gone better than a banner can.
        if (err instanceof KandyError && err.code === "board_not_found") return
        if (isUnreachable(err)) {
          unreachable.current?.()
          return setError(UNREACHABLE)
        }
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      close?.()
    }
  }, [boardId, client, hub, epoch])

  /**
   * Backfill a run's transcript from disk when its note is opened.
   *
   * Tracked so reopening a note doesn't refetch what we already hold — that
   * showed as the stream blanking and repopulating on every click.
   */
  const fetched = useRef(new Set<string>())

  const loadTranscript = useCallback(
    async (runId: string) => {
      if (fetched.current.has(runId)) return
      fetched.current.add(runId)
      try {
        // Paged on the server; one page was the start of a long run and
        // nothing after it.
        const frames: TranscriptFrame[] = []
        let after: number | null = 0
        while (after !== null) {
          const page: { frames: TranscriptFrame[]; nextAfter: number | null } =
            await client.transcript(runId, after)
          frames.push(...page.frames)
          after = page.nextAfter !== null && page.nextAfter !== after ? page.nextAfter : null
        }
        setTranscript((t) => {
          const live = t[runId] ?? []
          const seen = new Set(frames.map((f) => f.seq))
          return { ...t, [runId]: [...frames, ...live.filter((f) => !seen.has(f.seq))] }
        })
      } catch {
        // A missing transcript is not worth an error banner; the note may
        // simply never have run. Allow a retry if it was a blip.
        fetched.current.delete(runId)
      }
    },
    [client],
  )

  /**
   * Commands do not merge a response body — they return a seq and the change
   * arrives on the stream like every other change. One code path for state,
   * which is what makes two browser tabs agree for free.
   */
  const act = useCallback(
    async <T,>(fn: (c: KandyClient) => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn(client)
      } catch (err) {
        if (isUnreachable(err)) {
          unreachable.current?.()
          setError(UNREACHABLE)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
        return undefined
      }
    },
    [client],
  )

  return {
    client,
    view,
    connected,
    error,
    act,
    transcript,
    activity,
    recent,
    loadTranscript,
    clearError: () => setError(null),
  }
}

/** Newest first, each event once, no more than the list shows. */
function merge(have: KandyEvent[], more: KandyEvent[]): KandyEvent[] {
  const bySeq = new Map(have.map((e) => [e.seq, e]))
  for (const e of more) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, RECENT)
}
