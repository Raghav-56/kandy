import { daemonToken } from "@/lib/daemon-token"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KandyClient } from "@kandy/client"
import {
  reduce,
  type ActivityFrame,
  type BoardView,
  type KandyEvent,
  type TranscriptFrame,
} from "@kandy/core"

/** How many attributed events the Team page's activity list keeps. */
const RECENT = 50

/**
 * Snapshot, then stream. The reducer is the one in @kandy/core — the same code
 * the server projects with and the TUI will render with.
 */
export function useBoard(boardId: string | null, opts: { hub?: boolean } = {}) {
  const hub = opts.hub ?? false
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
          onError: () => setConnected(false),
          onTranscript: (frame) => {
            setTranscript((t) => {
              const prev = t[frame.runId] ?? []
              if (prev.some((f) => f.seq === frame.seq)) return t
              // An agent can talk for a long time. Keep the tail; the full
              // record is on disk and one fetch away.
              return { ...t, [frame.runId]: [...prev, frame].slice(-400) }
            })
          },
          onActivity: (frame) => setActivity((a) => ({ ...a, [frame.runId]: frame })),
        })
        setConnected(true)
      })
      .catch((err: Error) => !cancelled && setError(err.message))

    return () => {
      cancelled = true
      close?.()
    }
  }, [boardId, client, hub])

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
        const { frames } = await client.transcript(runId)
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
        setError(err instanceof Error ? err.message : String(err))
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
