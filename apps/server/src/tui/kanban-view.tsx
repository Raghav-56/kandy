/**
 * The kanban, drawn. Every rectangle comes from `layout()` in kanban.ts — the
 * same numbers the mouse is mapped back through — so what you click is what
 * was drawn there.
 */
import type { BoardView, RunnerInfo } from "@kandy/core"
import { Box, Text } from "ink"
import type { ReactNode } from "react"
import { CARD_H, COL_GAP, cardText, paperOf, type ColumnBox, type Focus, type Layout } from "./kanban.js"
import { paperColors, toneProps, type Palette, type Tone } from "./theme.js"
import { fit, textWidth, truncate } from "./text.js"
import { Segs } from "./ui.js"

export type DragState = { note: string; over: string | null }

const LANE_TONE: Record<string, Tone> = { inbox: "plain", queued: "cyan", running: "cyan", review: "mint", done: "dim" }

export function Kanban({
  l,
  view,
  focus,
  drag,
  now,
  tick,
  hub,
  runners,
  empty,
  p,
}: {
  l: Layout
  view: BoardView
  focus: Focus | null
  drag: DragState | null
  now: number
  tick: number
  hub: boolean
  runners: readonly RunnerInfo[]
  /** What to say in a column with nothing in it. */
  empty: (col: ColumnBox) => string
  p: Palette
}) {
  return (
    <Box flexDirection="row" height={l.height} width={l.width}>
      {l.columns.map((c, i) => (
        <Box key={c.column.id} flexDirection="column" width={c.w} marginRight={i < l.columns.length - 1 ? COL_GAP : 0}>
          {columnHeader(c, i, l, focus, drag, p)}
          {c.cards.length === 0 ? (
            <Text dimColor wrap="truncate-end">
              {" " + truncate(empty(c), c.w - 2)}
            </Text>
          ) : (
            c.cards.map((card) => {
              const selected = focus?.note === card.note.id
              const dragging = drag?.note === card.note.id
              const colors = paperColors(paperOf(view, card.note), selected || dragging)
              const text = cardText(view, card.note, card.w - 4, now, tick, { hub, runners })
              return (
                <Box
                  key={card.note.id}
                  width={card.w}
                  height={CARD_H}
                  flexDirection="column"
                  borderStyle={dragging ? "double" : colors.style}
                  {...(colors.border ? { borderColor: colors.border } : {})}
                  // Ink doesn't paint padding, so the text carries its own
                  // one-cell margin and the paper reaches the border. (Painting
                  // the border's cells too bleeds the colour into the column.)
                  {...(colors.bg ? { backgroundColor: colors.bg } : {})}
                >
                  <Text bold={selected} wrap="truncate-end" {...(colors.title ? { color: colors.title } : {})}>
                    {" " + fit(text.title[0], card.w - 4) + " "}
                  </Text>
                  <Text bold={selected} wrap="truncate-end" {...(colors.title ? { color: colors.title } : {})}>
                    {" " + fit(text.title[1], card.w - 4) + " "}
                  </Text>
                  <Segs segs={[{ text: " ", tone: "plain" }, ...text.meta, { text: " ", tone: "plain" }]} p={p} />
                </Box>
              )
            })
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * "REVIEW 3", with what's scrolled out of sight — above, below, and, on the
 * outermost columns, how many columns are off screen to that side.
 */
function columnHeader(c: ColumnBox, i: number, l: Layout, focus: Focus | null, drag: DragState | null, p: Palette): ReactNode {
  const focused = focus?.column === c.column.id
  const target = drag !== null && drag.over === c.column.id
  const left = i === 0 && l.left > 0 ? `‹${l.left} ` : ""
  const right = i === l.columns.length - 1 && l.right > 0 ? ` ${l.right}›` : ""
  const more = [c.above ? `↑${c.above}` : "", c.below ? `↓${c.below}` : ""].filter(Boolean).join(" ")
  const name = `${left}${c.column.name.toUpperCase()} ${c.column.notes.length}`
  const tail = `${more}${right}`
  const room = Math.max(0, c.w - textWidth(name) - textWidth(tail) - 1)
  const tone = LANE_TONE[c.column.lane ?? ""] ?? "plain"
  return (
    <Text wrap="truncate-end" inverse={target}>
      <Text bold {...toneProps(p, focused ? tone : "dim")} underline={focused}>
        {name}
      </Text>
      <Text dimColor>{" " + "─".repeat(room)}</Text>
      <Text {...toneProps(p, "lemon")}>{tail}</Text>
    </Text>
  )
}
