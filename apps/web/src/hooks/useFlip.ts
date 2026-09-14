import { useLayoutEffect, useRef } from "react"
import { animate } from "animejs"
import { RISE, motionAllowed } from "@/lib/motion"

/**
 * Keep the eye on a row that just moved.
 *
 * Notes are grouped by status, so a run finishing teleports its row from
 * "Working" to "Ready to review" — often past a dozen others. The row you were
 * watching is simply somewhere else on the next frame, and the only way to
 * find it again is to re-read the list.
 *
 * FLIP: compare where each row was on the last commit with where it is now,
 * then animate the difference away. The layout is never faked — rows are
 * already in their final positions, and the transform that makes them look
 * otherwise unwinds to zero.
 *
 * This is the one thing here CSS genuinely cannot do: a transition needs two
 * values on one element, and these rows have no "from" — they were somewhere
 * else, in a different part of the tree.
 *
 * @param keys Row identity in render order. Only a change here animates.
 */
export function useFlip(container: React.RefObject<HTMLElement | null>, keys: string) {
  const before = useRef(new Map<string, DOMRect>())
  const first = useRef(true)

  /*
   * Animate, reading the measurements taken after the *previous* commit.
   *
   * This has to be declared before the effect that records positions. Both run
   * after React has already updated the DOM, in declaration order — so if the
   * recording ran first it would overwrite the previous frame's numbers with
   * the current ones, every delta would be zero, and nothing would ever move.
   */
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return

    // Nothing to animate from on first paint, and nothing to animate at all
    // for someone who asked not to see it.
    if (first.current) {
      first.current = false
      return
    }
    if (!motionAllowed()) return

    for (const row of el.querySelectorAll<HTMLElement>("[data-flip]")) {
      const id = row.dataset["flip"]
      if (!id) continue
      const was = before.current.get(id)
      if (!was) continue

      const dy = was.top - row.getBoundingClientRect().top
      // Sub-pixel drift from a reflow is not movement worth animating.
      if (Math.abs(dy) <= 1) continue

      animate(row, {
        translateY: [dy, 0],
        duration: 320,
        ease: RISE,
      })
    }
  }, [keys, container])

  /** Record where everything ended up, for the next commit to compare against. */
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const next = new Map<string, DOMRect>()
    for (const row of el.querySelectorAll<HTMLElement>("[data-flip]")) {
      const id = row.dataset["flip"]
      if (id) next.set(id, row.getBoundingClientRect())
    }
    before.current = next
  })
}
