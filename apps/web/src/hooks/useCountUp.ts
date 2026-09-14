import { useEffect, useRef, useState } from "react"
import { animate } from "animejs"
import { RISE, motionAllowed } from "@/lib/motion"

/**
 * Count to a number instead of snapping to it.
 *
 * Usage figures arrive all at once when the page mounts and again whenever a
 * run reports its cost. Snapping gives no sense that the number moved, or by
 * how much — and spend in particular is a number you want to feel.
 *
 * A tween over a value rather than a property, which is why this is JS: there
 * is no CSS transition for "the text content changed".
 *
 * Returns the live value; the caller still owns formatting, so money stays
 * money and tokens stay compact.
 */
export function useCountUp(target: number, ms = 650): number {
  const [n, setN] = useState(target)
  const from = useRef(target)

  useEffect(() => {
    if (from.current === target) return

    if (!motionAllowed()) {
      from.current = target
      setN(target)
      return
    }

    const state = { v: from.current }
    const a = animate(state, {
      v: target,
      duration: ms,
      ease: RISE,
      onUpdate: () => setN(state.v),
      // Land exactly on the target — a tween can stop a hair short, and a
      // spend figure that reads $46.24 instead of $46.25 is a bug.
      onComplete: () => setN(target),
    })
    from.current = target
    return () => {
      a.pause()
    }
  }, [target, ms])

  return n
}
