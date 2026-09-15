import { cubicBezier } from "animejs"

/**
 * kandy's easing, for the few animations that run in JS.
 *
 * These mirror --ease-rise and --ease-spring in styles.css — and did not,
 * until a UI audit noticed the CSS tokens had never been defined at all and
 * that the numbers here were a weaker curve than the ones documented. anime.js v4
 * removed the string syntax for easings, so a curve has to be a function —
 * which means the values cannot be read from the stylesheet at runtime and
 * are repeated here instead. Keep the two in step; this is the only copy.
 */
export const RISE = cubicBezier(0.23, 1, 0.32, 1)
export const SPRING = cubicBezier(0.34, 1.4, 0.64, 1)

/** Whether to animate at all. Checked at call time, not at import. */
export function motionAllowed(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
