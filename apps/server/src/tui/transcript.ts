/**
 * A note's transcript as rows, and the scroll state that tails it.
 *
 * Frames arrive from two places — a backfill from disk and the live stream —
 * in either order, possibly twice. `mergeFrames` makes that one ordered list.
 * `transcriptRows` turns runs of frames into pre-wrapped rows so scrolling
 * can count them; `Follow` pins the view to the bottom until the reader
 * scrolls up, and re-pins when they come back down.
 */
import type { Run, TranscriptFrame } from "@kandy/core"
import { agentLabel, formatDuration } from "./board.js"
import type { Tone } from "./theme.js"
import { truncate, wrap } from "./text.js"

/** Live frames kept per run. The full record is on disk, one fetch away. */
export const FRAME_CAP = 2000

export function mergeFrames(
  have: readonly TranscriptFrame[],
  more: readonly TranscriptFrame[],
  cap = FRAME_CAP,
): TranscriptFrame[] {
  if (more.length === 0) return have as TranscriptFrame[]
  const seen = new Set(have.map((f) => f.seq))
  const fresh = more.filter((f) => !seen.has(f.seq) && (seen.add(f.seq), true))
  if (fresh.length === 0) return have as TranscriptFrame[]
  const last = have[have.length - 1]
  const inOrder = fresh.every((f, i) => (i === 0 ? !last || f.seq > last.seq : f.seq > fresh[i - 1]!.seq))
  const all = inOrder ? [...have, ...fresh] : [...have, ...fresh].sort((a, b) => a.seq - b.seq)
  return all.length > cap ? all.slice(-cap) : all
}

export type Seg = { text: string; tone: Tone; bold?: boolean; italic?: boolean; inverse?: boolean }
/** One terminal row, as styled segments. */
export type TRow = Seg[]

/** Tool output past this many rows is folded; the diff is where changes are read. */
export const TOOL_ROWS = 6

/**
 * Wrapping is the expensive part and frames never change once received, so
 * each frame's rows are remembered per width. Keyed by the frame object:
 * when a run's frames are dropped, so is this.
 */
const rowCache = new WeakMap<TranscriptFrame, { width: number; rows: TRow[] }>()

function frameRows(f: TranscriptFrame, width: number): TRow[] {
  const hit = rowCache.get(f)
  if (hit && hit.width === width) return hit.rows
  const rows = computeFrameRows(f, width)
  rowCache.set(f, { width, rows })
  return rows
}

function computeFrameRows(f: TranscriptFrame, width: number): TRow[] {
  switch (f.role) {
    case "assistant":
      return wrap(f.text, width).map((t) => [{ text: t, tone: "plain" }])
    case "user": {
      const rows = wrap(f.text, width - 2)
      return rows.map((t, i) => [
        { text: i === 0 ? "› " : "  ", tone: "mint", bold: true },
        { text: t, tone: "plain", bold: true },
      ])
    }
    case "tool": {
      const name = (f.meta ?? "tool").trim() || "tool"
      const label = truncate(name, Math.max(4, Math.floor(width / 3)))
      const indent = label.length + 1
      const body = wrap(f.text, Math.max(8, width - indent))
      const shown = body.slice(0, TOOL_ROWS)
      const rows: TRow[] = shown.map((t, i) => [
        { text: i === 0 ? label + " " : " ".repeat(indent), tone: "dim", bold: i === 0 },
        { text: t, tone: "dim" },
      ])
      if (body.length > TOOL_ROWS) {
        rows.push([{ text: " ".repeat(indent) + `… ${body.length - TOOL_ROWS} more lines`, tone: "dim", italic: true }])
      }
      return rows
    }
    case "system":
      return wrap(f.text, width).map((t) => [{ text: t, tone: "dim", italic: true }])
    case "error":
      return wrap(f.text, width - 2).map((t, i) => [
        { text: i === 0 ? "✗ " : "  ", tone: "berry", bold: true },
        { text: t, tone: "berry" },
      ])
  }
}

export type RunFrames = { run: Run; frames: readonly TranscriptFrame[] }

/**
 * Every run of a note, oldest first, separated by a rule naming the agent.
 * A blank row goes between frames except inside a run of tool calls, which
 * read better as one block.
 */
export function transcriptRows(runs: readonly RunFrames[], width: number, now = Date.now()): TRow[] {
  const w = Math.max(10, width)
  const out: TRow[] = []
  runs.forEach(({ run, frames }, i) => {
    if (runs.length > 1 || i > 0) {
      if (out.length > 0) out.push([])
      const took = formatDuration((run.endedAt ?? now) - run.startedAt)
      const title = ` run ${i + 1} · ${agentLabel(run.agent)} · ${run.status} · ${took} `
      const rule = "──" + title + "─".repeat(Math.max(0, w - title.length - 2))
      out.push([{ text: truncate(rule, w), tone: "dim" }])
    }
    let prev: TranscriptFrame | null = null
    for (const f of frames) {
      if (prev && !(prev.role === "tool" && f.role === "tool")) out.push([])
      out.push(...frameRows(f, w))
      prev = f
    }
    if (frames.length === 0 && run.error) out.push(...frameRows(errorFrame(run), w))
  })
  return out
}

function errorFrame(run: Run): TranscriptFrame {
  return { kind: "transcript", runId: run.id, seq: 0, ts: run.endedAt ?? run.startedAt, role: "error", text: run.error ?? "" }
}

// --- follow ----------------------------------------------------------------

/** `offset` is the first visible row; while `follow`, it is always the last page. */
export type Follow = { offset: number; follow: boolean }

export const FOLLOWING: Follow = { offset: 0, follow: true }

function maxOffset(total: number, height: number): number {
  return Math.max(0, total - Math.max(1, height))
}

/** Where the view actually starts, given how many rows there are now. */
export function viewStart(f: Follow, total: number, height: number): number {
  const max = maxOffset(total, height)
  return f.follow ? max : Math.min(f.offset, max)
}

/**
 * Scroll by `delta` rows (negative is up). Leaving the bottom unpins; landing
 * on it pins again, so new frames resume tailing without a keypress.
 */
export function scroll(f: Follow, delta: number, total: number, height: number): Follow {
  const max = maxOffset(total, height)
  const offset = Math.max(0, Math.min(max, viewStart(f, total, height) + delta))
  return { offset, follow: offset >= max }
}

export function toTop(): Follow {
  return { offset: 0, follow: false }
}

export function toBottom(): Follow {
  return FOLLOWING
}
