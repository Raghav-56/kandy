import type { Note, NoteStatus } from "@kandy/core"

/**
 * The candy status language.
 *
 * Every state has a colour AND a word, because roughly eight percent of men
 * cannot reliably separate the berry from the mint. `blocked` is the only
 * status that legitimately demands attention, so it is the only one allowed to
 * be loud; `done` recedes until it is nearly invisible.
 */
export type Tone = "neutral" | "berry" | "mint" | "lemon" | "sky" | "grape"

export type Look = {
  tone: Tone
  label: string
  /** Where it sorts in the triage list. Lower is more urgent. */
  urgency: number
  /** Paper surface for the card view. */
  surface: string
  ink: string
  muted: string
  rule: string
}

const PAPER = {
  surface: "bg-paper",
  ink: "text-paper-ink",
  muted: "text-[#6f6a5c]",
  rule: "bg-black/[0.07]",
}

export const LOOK: Record<NoteStatus, Look> = {
  blocked: { ...PAPER, surface: "bg-[#f6dcd9]", muted: "text-[#7d5a58]", tone: "berry", label: "Needs you", urgency: 0 },
  review:  { ...PAPER, tone: "mint",    label: "Ready to review", urgency: 1 },
  failed:  { surface: "bg-berry-bg border border-berry/30", ink: "text-berry", muted: "text-berry/70", rule: "bg-berry/30", tone: "berry", label: "Failed", urgency: 2 },
  running: { ...PAPER, tone: "lemon",   label: "Running", urgency: 3 },
  queued:  { ...PAPER, surface: "bg-paper-2", tone: "sky", label: "Queued", urgency: 4 },
  draft:   { ...PAPER, tone: "neutral", label: "Draft", urgency: 5 },
  done:    { surface: "bg-raised border border-line", ink: "text-dim", muted: "text-faint", rule: "bg-line", tone: "neutral", label: "Done", urgency: 6 },
}

/** Triage groups, in the order a person should deal with them. */
export const GROUPS: { key: string; title: string; statuses: NoteStatus[] }[] = [
  { key: "attention", title: "Needs you", statuses: ["blocked", "failed"] },
  { key: "review", title: "Ready to review", statuses: ["review"] },
  { key: "working", title: "Working", statuses: ["running", "queued"] },
  { key: "backlog", title: "Backlog", statuses: ["draft"] },
  { key: "done", title: "Done", statuses: ["done"] },
]

/**
 * The look for one note, rather than for its status.
 *
 * `done` covers both verdicts, and "Done" on a note whose work was thrown away
 * read as if it had landed. The TUI already says ✓ merged / – discarded; this
 * is the same distinction in the same words.
 */
export function lookOf(note: Pick<Note, "status" | "outcome">): Look {
  const look = LOOK[note.status]
  if (note.status !== "done" || !note.outcome) return look
  return { ...look, label: note.outcome === "discarded" ? "– Discarded" : "✓ Merged" }
}

/** Whether a note's changes still stand — a discarded note's diff went with it. */
export function changesStand(note: Pick<Note, "outcome">): boolean {
  return note.outcome !== "discarded"
}
