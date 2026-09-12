import { useEffect, useState } from "react"

/**
 * Re-render on an interval so elapsed times count up.
 *
 * Gated on `active` — a board of finished notes should not re-render once a
 * second forever just because it once had something running.
 */
export function useTick(active: boolean, ms = 1000): void {
  const [, force] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => force((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [active, ms])
}
