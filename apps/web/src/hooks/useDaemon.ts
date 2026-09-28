import { useCallback, useEffect, useRef, useState } from "react"
import type { KandyClient } from "@kandy/client"

/** How often to look for the daemon while it is gone. */
const RETRY_MS = 2_000

/** Said instead of the browser's "Failed to fetch", which names nothing. */
export const UNREACHABLE = "Couldn't reach kandy — it may have stopped. Start it again with `kandy`."

/**
 * Whether a failed request failed because nothing answered.
 *
 * `fetch` rejects with a TypeError for a refused connection and for nothing
 * else a request can do — every answer the daemon gives, errors included,
 * resolves. So this is "the daemon is gone", not "the daemon said no".
 */
export function isUnreachable(err: unknown): boolean {
  return err instanceof TypeError
}

/**
 * Whether the daemon behind this page is still there.
 *
 * The page is served by the daemon, so when it stops nothing on screen
 * changes: a run that died with it kept counting up with a live Stop, and
 * every button failed with "Failed to fetch". Anything that notices a failure
 * reports it here; only a health check that also fails turns it into `down`,
 * so a blip in the event stream does not flash a banner. While down it keeps
 * asking, and the first answer bumps `epoch` — the signal for everything
 * else to fetch again rather than trust what it had before the gap. Runs that
 * were in flight come back failed, which the fresh snapshot says.
 */
export function useDaemon(client: KandyClient) {
  const [down, setDown] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const checking = useRef(false)
  const wasDown = useRef(false)

  const check = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    try {
      await client.health()
      // Only a real gap asks everything to refetch. A blip the health check
      // never saw is the event stream's own to retry, and bumping on every
      // report would loop on a stream that errors while the daemon is fine.
      if (wasDown.current) {
        wasDown.current = false
        setDown(false)
        setEpoch((e) => e + 1)
      }
    } catch {
      wasDown.current = true
      setDown(true)
    } finally {
      checking.current = false
    }
  }, [client])

  const report = useCallback(() => void check(), [check])

  useEffect(() => {
    if (!down) return
    const t = setInterval(() => void check(), RETRY_MS)
    return () => clearInterval(t)
  }, [down, check])

  return { down, epoch, report }
}
