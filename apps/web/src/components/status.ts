import type { NoteStatus } from "@kandy/core"

/**
 * The achromatic status language.
 *
 * DESIGN.md forbids colour outright, which turns out to be a better constraint
 * than a limitation: status has to be carried by *value* and *motion*, and both
 * survive a glance across a room better than hue does. Inversion is the loudest
 * signal the palette has, so `blocked` — the only status that legitimately
 * demands attention — is the one that gets it.
 */
export type Surface = {
  face: string
  ink: string
  /** Muted ink for the status label and metadata. */
  dim: string
  /** Pushed back in Z; finished work recedes. */
  depth: number
  scale: number
}

export const SURFACES: Record<NoteStatus, Surface> = {
  draft:   { face: "#ffffff", ink: "#000000", dim: "#575757", depth: 0,     scale: 1 },
  queued:  { face: "#d4d4d4", ink: "#000000", dim: "#575757", depth: -0.25, scale: 0.98 },
  running: { face: "#ffffff", ink: "#000000", dim: "#000000", depth: 0.35,  scale: 1.02 },
  blocked: { face: "#0a0a0a", ink: "#ffffff", dim: "#ffffff", depth: 0.5,   scale: 1.03 },
  review:  { face: "#ffffff", ink: "#000000", dim: "#000000", depth: 0.2,   scale: 1 },
  done:    { face: "#1c1c1c", ink: "#575757", dim: "#454545", depth: -0.6,  scale: 0.9 },
  failed:  { face: "#0a0a0a", ink: "#ffffff", dim: "#575757", depth: -0.1,  scale: 0.96 },
}

export const CARD = { w: 2.0, h: 1.25, d: 0.05 }
export const LANE_GAP = 2.45
export const ROW_GAP = 1.5
