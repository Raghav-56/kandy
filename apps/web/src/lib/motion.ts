import { cubicBezier } from "animejs"

/**
 * kandy's easing, for the few animations that run in JS.
 *
 * These mirror --ease-rise and --ease-spring in styles.css. anime.js v4
 * removed the string syntax for easings, so a curve has to be a function —
 * which means the values cannot be read from the stylesheet at runtime and
 * are repeated here instead. Keep the two in step; this is the only copy.
 */
export const RISE = cubicBezier(0.2, 0.7, 0.3, 1)
export const SPRING = cubicBezier(0.34, 1.4, 0.64, 1)

/** Whether to animate at all. Checked at call time, not at import. */
export function motionAllowed(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
