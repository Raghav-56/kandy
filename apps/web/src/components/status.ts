import type { NoteStatus } from "@kandy/core"

/**
 * One warm paper tone carries almost every note; status is a dot and a word.
 *
 * The earlier version tinted the whole card per status and the board turned
 * into a bag of sweets. Only two statuses earn a surface change: `blocked`,
 * which is the one state that legitimately demands attention, and `done`,
 * which should recede until it's invisible.
 */
export type Style = {
  /** Card surface. */
  surface: string
  ink: string
  muted: string
  /** The status dot. */
  dot: string
  label: string
}

export const STYLES: Record<NoteStatus, Style> = {
  draft: {
    surface: "bg-paper text-paper-ink",
    ink: "text-paper-ink",
    muted: "text-[#6b6759]",
    dot: "bg-[#a9a294]",
    label: "draft",
  },
  queued: {
    surface: "bg-paper-2 text-paper-ink",
    ink: "text-paper-ink",
    muted: "text-[#6b6759]",
    dot: "bg-azure",
    label: "queued",
  },
  running: {
    surface: "bg-paper text-paper-ink",
    ink: "text-paper-ink",
    muted: "text-[#6b6759]",
    dot: "bg-amber",
    label: "running",
  },
  blocked: {
    surface: "bg-[#f6dcd4] text-paper-ink",
    ink: "text-paper-ink",
    muted: "text-[#7a5c53]",
    dot: "bg-coral",
    label: "needs you",
  },
  review: {
    surface: "bg-paper text-paper-ink",
    ink: "text-paper-ink",
    muted: "text-[#6b6759]",
    dot: "bg-sage",
    label: "review",
  },
  done: {
    surface: "bg-panel-2 text-dim border border-line",
    ink: "text-dim",
    muted: "text-faint",
    dot: "bg-[#3a3a42]",
    label: "done",
  },
  failed: {
    surface: "bg-[#1d1312] text-[#e8b3a8] border border-[#3d2621]",
    ink: "text-[#e8b3a8]",
    muted: "text-[#8a5f56]",
    dot: "bg-coral",
    label: "failed",
  },
}
