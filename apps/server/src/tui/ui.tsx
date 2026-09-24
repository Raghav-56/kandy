/**
 * Presentational pieces. Every component here draws exactly the rows it is
 * given — width and height are decided by the caller, from pure functions —
 * so nothing reflows unexpectedly and a frame is always the terminal's size.
 */
import { Text } from "ink"
import type { ReactNode } from "react"
import { fitHints, type Hint } from "./keys.js"
import { toneProps, type Palette, type Tone } from "./theme.js"
import { fit, textWidth, truncate } from "./text.js"
import type { Seg } from "./transcript.js"

export function Segs({ segs, p }: { segs: readonly Seg[]; p: Palette }) {
  if (segs.length === 0) return <Text> </Text>
  return (
    <Text wrap="truncate-end">
      {segs.map((s, i) => (
        <Text
          key={i}
          {...toneProps(p, s.tone)}
          bold={s.bold ?? false}
          italic={s.italic ?? false}
          inverse={s.inverse ?? false}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  )
}

/** A full-width row of `─`, optionally titled. */
export function Rule({ width, title, p, tone = "dim" }: { width: number; title?: string; p: Palette; tone?: Tone }) {
  const head = title ? `── ${title} ` : ""
  return (
    <Text {...toneProps(p, tone)} wrap="truncate-end">
      {truncate(head + "─".repeat(Math.max(0, width - textWidth(head))), width)}
    </Text>
  )
}

/** Left and right content on one row, the right side winning when space is short. */
export function Split({
  left,
  right,
  width,
  p,
}: {
  left: readonly Seg[]
  right: readonly Seg[]
  width: number
  p: Palette
}) {
  const rightW = right.reduce((n, s) => n + textWidth(s.text), 0)
  const room = Math.max(0, width - rightW - 1)
  const out: Seg[] = []
  let used = 0
  for (const s of left) {
    if (used >= room) break
    const t = truncate(s.text, room - used)
    out.push({ ...s, text: t })
    used += textWidth(t)
  }
  out.push({ text: " ".repeat(Math.max(1, width - used - rightW)), tone: "plain" })
  return <Segs segs={[...out, ...right]} p={p} />
}

export function Hints({ hints, width, p }: { hints: readonly Hint[]; width: number; p: Palette }) {
  const segs: Seg[] = []
  for (const h of fitHints(hints, width)) {
    segs.push({ text: h.key, tone: "plain", bold: true }, { text: " " + h.label + "  ", tone: "dim" })
  }
  return <Segs segs={[{ text: " ", tone: "plain" }, ...segs]} p={p} />
}

/** Pad a list of row nodes to exactly `height`, so the footer never moves. */
export function Fill({ rows, height }: { rows: ReactNode[]; height: number }) {
  const out = rows.slice(0, Math.max(0, height))
  while (out.length < height) out.push(<Text key={`fill-${out.length}`}> </Text>)
  return <>{out}</>
}

export function Padded({ text, width, tone, p, bold }: { text: string; width: number; tone: Tone; p: Palette; bold?: boolean }) {
  return (
    <Text {...toneProps(p, tone)} bold={bold ?? false} wrap="truncate-end">
      {fit(text, width)}
    </Text>
  )
}
