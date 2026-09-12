import type { NoteStatus } from "@kandy/core"

/**
 * One warm paper tone carries almost every note; status is an edge, a dot and
 * a word. An earlier version tinted the whole card per status and the board
 * turned into a bag of sweets — only `blocked` and `done` earn a surface.
 */
export type Style = {
  surface: string
  /** 3px spine down the left edge — the fastest read on the card. */
  edge: string
  dot: string
  label: string
  /** Muted ink for metadata on this surface. */
  muted: string
  rule: string
}

const PAPER = {
  surface: "bg-paper",
  muted: "text-[#6b6759]",
  rule: "bg-black/[0.07]",
}

export const STYLES: Record<NoteStatus, Style> = {
  draft: { ...PAPER, edge: "bg-[#c4bda9]", dot: "bg-[#a9a294]", label: "Draft" },
  queued: { ...PAPER, surface: "bg-paper-2", edge: "bg-azure", dot: "bg-azure", label: "Queued" },
  running: { ...PAPER, edge: "bg-amber", dot: "bg-amber", label: "Running" },
  blocked: {
    surface: "bg-[#f6dcd4]",
    muted: "text-[#7a5c53]",
    rule: "bg-black/[0.08]",
    edge: "bg-coral",
    dot: "bg-coral",
    label: "Needs you",
  },
  review: { ...PAPER, edge: "bg-sage", dot: "bg-sage", label: "Review" },
  done: {
    surface: "bg-panel-2 border border-line",
    muted: "text-faint",
    rule: "bg-line",
    edge: "bg-[#33333c]",
    dot: "bg-[#3a3a42]",
    label: "Done",
  },
  failed: {
    surface: "bg-[#1d1312] border border-[#3d2621]",
    muted: "text-[#8a5f56]",
    rule: "bg-[#3d2621]",
    edge: "bg-coral",
    dot: "bg-coral",
    label: "Failed",
  },
}

/** Ink colour for the title, which differs on the two dark surfaces. */
export function inkFor(status: NoteStatus): string {
  if (status === "done") return "text-dim"
  if (status === "failed") return "text-[#e8b3a8]"
  return "text-paper-ink"
}
