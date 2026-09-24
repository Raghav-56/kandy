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
 * How far back to replay on a hub, so the activity list opens with history.
 *
 * There is no "recent events" endpoint, but the stream already replays
 * everything after the seq it is given — so asking from a little before the
 * snapshot backfills the list for the cost of a few hundred small frames. The
 * view is not refolded from them: anything at or below the snapshot's seq is
 * skipped exactly as before. Off a hub every actor is null, so this is 0 and
 * the stream starts where it always did.
 */
const BACKFILL = 400

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

        close = client.events(hub ? Math.max(0, snapshot.seq - BACKFILL) : snapshot.seq, {
          onEvent: (e) => {
            if (e.actor)
              setRecent((r) =>
                r.some((x) => x.seq === e.seq) ? r : [e, ...r].sort((a, b) => b.seq - a.seq).slice(0, RECENT),
              )
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
