import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KandyClient } from "@kandy/client"
import { reduce, type BoardView } from "@kandy/core"

/**
 * Snapshot, then stream. The reducer is the one in @kandy/core — the same code
 * the server projects with and the TUI will render with.
 */
export function useBoard(boardId: string | null) {
  const client = useMemo(() => new KandyClient({ baseUrl: "/api" }), [])
  const [view, setView] = useState<BoardView | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The stream must not be torn down and rebuilt every time the view updates,
  // so the live seq lives in a ref rather than the effect's dependencies.
  const seq = useRef(0)

  useEffect(() => {
    if (!boardId) return
    let cancelled = false
    let close: (() => void) | undefined

    client
      .view(boardId)
      .then((snapshot) => {
        if (cancelled) return
        setView(snapshot)
        seq.current = snapshot.seq
        setError(null)

        close = client.events(
          snapshot.seq,
          (e) => {
            // First event through the stream is proof the connection is real.
            // Setting this before subscribing would make a failed stream look
            // healthy, which is the one thing a status dot must never do.
            setConnected(true)
            // Skip anything already folded into the snapshot.
            if (e.seq <= seq.current) return
            seq.current = e.seq
            setView((v) => (v ? reduce(v, e) : v))
          },
          () => setConnected(false),
        )
        // No event may arrive for a while on a quiet board; the absence of an
        // error is good enough to call it connected.
        setConnected(true)
      })
      .catch((err: Error) => !cancelled && setError(err.message))

    return () => {
      cancelled = true
      close?.()
    }
  }, [boardId, client])

  /**
   * Commands do not merge a response body — they return a seq and the change
   * arrives on the stream like every other change. One code path for state,
   * which is what makes two browser tabs agree for free.
   */
  const act = useCallback(async (fn: (c: KandyClient) => Promise<unknown>) => {
    try {
      await fn(client)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [client])

  return { client, view, connected, error, act, clearError: () => setError(null) }
}
