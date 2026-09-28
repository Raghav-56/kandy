/**
 * The board as a kanban: the board's own columns side by side, each note a
 * card in its column.
 *
 * Geometry is decided here, in plain numbers, and the screen draws exactly
 * these rectangles — so a click can be mapped back to the card under it by the
 * same arithmetic, and nothing about hit-testing depends on how Ink lays out.
 *
 * Pure functions over a `BoardView`. Nothing here knows about Ink.
 */
import { notesIn, type BoardView, type Column, type Lane, type Note, type RunnerInfo } from "@kandy/core"
import { diffstat, failureOf, glyph, isLive, machineName, matches, noteClock, runOf } from "./board.js"
import type { Tone } from "./theme.js"
import { textWidth, truncate, wrap } from "./text.js"
import type { Seg } from "./transcript.js"

/** A card: top border, two lines of title, a line of detail, bottom border. */
export const CARD_H = 5
/** Blank columns of cells between two columns. */
export const COL_GAP = 1
/** Narrower than this and a card can't say anything; show fewer columns instead. */
export const MIN_COL_W = 24
/** A column's title row. */
export const HEADER_H = 1

export type KanbanColumn = { id: string; name: string; lane: Lane | null; notes: Note[] }

function byPos(a: Column, b: Column): number {
  return a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1
}

/**
 * Every column, in board order, empty ones included — an empty Running column
 * is information on a kanban. Notes a filter hides are left out; a note in a
 * column the view doesn't have goes in an "Other" column rather than vanishing.
 */
export function kanbanColumns(view: BoardView, filter = ""): KanbanColumn[] {
  const placed = new Set<string>()
  const cols: KanbanColumn[] = [...view.columns].sort(byPos).map((c) => {
    const notes = notesIn(view, c.id)
    for (const n of notes) placed.add(n.id)
    return { id: c.id, name: c.name, lane: c.lane, notes: notes.filter((n) => matches(n, filter)) }
  })
  const stray = view.notes.filter((n) => !placed.has(n.id) && matches(n, filter))
  if (stray.length) cols.push({ id: "?", name: "Other", lane: null, notes: stray })
  return cols
}

// --- focus -------------------------------------------------------------------

/** Where the keyboard is: a column, and a card in it (null when it's empty). */
export type Focus = { column: string; note: string | null }

/** Keep focus on the same card across updates; if it moved column, follow it. */
export function reconcileFocus(cols: readonly KanbanColumn[], focus: Focus | null): Focus | null {
  if (cols.length === 0) return null
  if (focus?.note) {
    const home = cols.find((c) => c.notes.some((n) => n.id === focus.note))
    if (home) return { column: home.id, note: focus.note }
  }
  const col = cols.find((c) => c.id === focus?.column) ?? cols.find((c) => c.notes.length > 0) ?? cols[0]!
  return { column: col.id, note: col.notes[0]?.id ?? null }
}

/**
 * Arrow keys. Across columns the row is kept where it can be — moving right
 * from the third card lands on the third card, or the last one if the column
 * is shorter — because that is where the eye already is.
 */
export function moveFocus(cols: readonly KanbanColumn[], focus: Focus, dx: number, dy: number): Focus {
  const ci = Math.max(0, cols.findIndex((c) => c.id === focus.column))
  const col = cols[ci]!
  const row = Math.max(0, col.notes.findIndex((n) => n.id === focus.note))
  if (dx !== 0) {
    const next = cols[Math.max(0, Math.min(cols.length - 1, ci + dx))]!
    const r = Math.min(row, next.notes.length - 1)
    return { column: next.id, note: r >= 0 ? next.notes[r]!.id : null }
  }
  if (col.notes.length === 0) return focus
  const r = Math.max(0, Math.min(col.notes.length - 1, row + dy))
  return { column: col.id, note: col.notes[r]!.id }
}

// --- geometry ----------------------------------------------------------------

export type CardBox = { note: Note; x: number; y: number; w: number; h: number; index: number }

export type ColumnBox = {
  column: KanbanColumn
  x: number
  w: number
  /** Index of the first card shown. */
  scroll: number
  /** Cards scrolled out of view above and below. */
  above: number
  below: number
  cards: CardBox[]
}

export type Layout = {
  /** Index of the first column on screen. */
  first: number
  /** Columns off screen to the left and right. */
  left: number
  right: number
  columns: ColumnBox[]
  /** How many cards fit in a column. */
  slots: number
  width: number
  height: number
}

export type LayoutInput = {
  cols: readonly KanbanColumn[]
  width: number
  height: number
  focus: Focus | null
  /** First column shown last frame, and each column's scroll — kept stable. */
  first: number
  scroll: Readonly<Record<string, number>>
}

/** How many columns fit side by side at this width. */
export function columnsThatFit(width: number, total: number): number {
  return Math.max(1, Math.min(total, Math.floor((width + COL_GAP) / (MIN_COL_W + COL_GAP))))
}

export function layout(inp: LayoutInput): Layout {
  const { cols, width, height, focus } = inp
  const slots = Math.max(1, Math.floor((height - HEADER_H) / CARD_H))
  if (cols.length === 0) return { first: 0, left: 0, right: 0, columns: [], slots, width, height }

  const shown = columnsThatFit(width, cols.length)
  const focusCol = Math.max(0, cols.findIndex((c) => c.id === focus?.column))
  // Scroll sideways only as far as it takes to keep the focused column on screen.
  let first = Math.max(0, Math.min(inp.first, cols.length - shown))
  if (focusCol < first) first = focusCol
  if (focusCol >= first + shown) first = focusCol - shown + 1

  const base = Math.floor((width - COL_GAP * (shown - 1)) / shown)
  const spare = width - COL_GAP * (shown - 1) - base * shown
  const columns: ColumnBox[] = []
  let x = 0
  for (let i = 0; i < shown; i++) {
    const column = cols[first + i]!
    const w = base + (i < spare ? 1 : 0)
    const total = column.notes.length
    // Keep the focused card in view, moving the column as little as possible.
    let scroll = Math.max(0, Math.min(inp.scroll[column.id] ?? 0, Math.max(0, total - slots)))
    if (column.id === focus?.column && focus.note) {
      const at = column.notes.findIndex((n) => n.id === focus.note)
      if (at >= 0 && at < scroll) scroll = at
      if (at >= scroll + slots) scroll = at - slots + 1
    }
    const cards = column.notes.slice(scroll, scroll + slots).map((note, j) => ({
      note,
      x,
      y: HEADER_H + j * CARD_H,
      w,
      h: CARD_H,
      index: scroll + j,
    }))
    columns.push({ column, x, w, scroll, above: scroll, below: Math.max(0, total - scroll - slots), cards })
    x += w + COL_GAP
  }
  return { first, left: first, right: cols.length - first - shown, columns, slots, width, height }
}

// --- what's under the pointer ------------------------------------------------

export type Hit =
  | { kind: "card"; column: string; note: string }
  /** Empty space in a column; `index` is where a dropped card would land. */
  | { kind: "column"; column: string; index: number }
  | { kind: "header"; column: string }

/** Body coordinates (0,0 = the top-left of the kanban area) to what's there. */
export function hitTest(l: Layout, x: number, y: number): Hit | null {
  if (y < 0 || y >= l.height) return null
  const col = l.columns.find((c) => x >= c.x && x < c.x + c.w)
  if (!col) return null
  if (y < HEADER_H) return { kind: "header", column: col.column.id }
  const card = col.cards.find((c) => y >= c.y && y < c.y + c.h)
  if (card) return { kind: "card", column: col.column.id, note: card.note.id }
  return { kind: "column", column: col.column.id, index: col.column.notes.length }
}

/**
 * The slot a card dropped at `y` lands in: above the card under the pointer if
 * the pointer is in its top half, below it otherwise.
 */
export function dropIndex(l: Layout, column: string, y: number): number {
  const col = l.columns.find((c) => c.column.id === column)
  if (!col) return 0
  const rel = y - HEADER_H
  if (rel < 0) return col.scroll
  const slot = Math.floor(rel / CARD_H)
  const half = rel % CARD_H >= CARD_H / 2 ? 1 : 0
  return Math.min(col.column.notes.length, col.scroll + slot + half)
}

// --- dropping a card ---------------------------------------------------------

export type Drop =
  /** Same column, new place: before/after are neighbour ids, as the server wants them. */
  | { kind: "reorder"; column: string; before?: string; after?: string }
  | { kind: "run" }
  | { kind: "merge" }
  | { kind: "move"; column: string; before?: string; after?: string }
  | { kind: "refuse"; why: string }
  | { kind: "none" }

/**
 * What dropping `note` into `to` at `index` means.
 *
 * The lifecycle columns aren't places a card can simply be put: the server
 * moves a note between Inbox, Queued, Running, Review and Done as its status
 * changes, so a card dragged into Done by hand would be back in Review a
 * moment later. A drop there means the action that would put it there — run
 * it, merge it — or nothing, with the reason.
 */
export function dropAction(cols: readonly KanbanColumn[], note: Note, to: string, index: number): Drop {
  const from = cols.find((c) => c.notes.some((n) => n.id === note.id))
  const dest = cols.find((c) => c.id === to)
  if (!from || !dest) return { kind: "none" }
  const others = dest.notes.filter((n) => n.id !== note.id)
  // Index counted with the card still in its old place; take it out first.
  const oldAt = dest.notes.findIndex((n) => n.id === note.id)
  const at = Math.max(0, Math.min(others.length, oldAt >= 0 && oldAt < index ? index - 1 : index))
  const neighbours = {
    ...(others[at] ? { before: others[at]!.id } : {}),
    ...(at > 0 && others[at - 1] ? { after: others[at - 1]!.id } : {}),
  }
  if (from.id === dest.id) {
    if (oldAt === at) return { kind: "none" }
    return { kind: "reorder", column: dest.id, ...neighbours }
  }
  if (dest.lane === null) return { kind: "move", column: dest.id, ...neighbours }
  if ((dest.lane === "queued" || dest.lane === "running") && note.status === "draft") return { kind: "run" }
  if (dest.lane === "done" && note.status === "review") return { kind: "merge" }
  return {
    kind: "refuse",
    why: `${dest.name} fills itself — notes move there as agents work. Drag a draft to Running to run it, or a note in Review to Done to merge it.`,
  }
}

// --- what a card says --------------------------------------------------------

/** A sticky note's colour: what state it's in, at a glance. */
export type Paper = "needs" | "running" | "review" | "failed" | "done" | "draft"

/** Since when a live note's agent has said nothing, once that's worth saying. */
export function quietSince(view: BoardView, note: Note): number | null {
  if (!isLive(note)) return null
  return view.runs.find((r) => r.id === note.runId)?.quietSince ?? null
}

export function paperOf(view: BoardView, note: Note): Paper {
  // A quiet run is yellow too: it may need someone to stop it.
  if (view.prompts.some((p) => p.noteId === note.id) || note.held || note.status === "blocked" || quietSince(view, note) !== null)
    return "needs"
  if (note.status === "failed") return "failed"
  if (note.status === "review") return "review"
  if (note.status === "done") return "done"
  if (isLive(note)) return "running"
  return "draft"
}

/** The word under a card's title: what it's doing, in the board's words. */
export function stateWord(view: BoardView, note: Note, now = Date.now()): string {
  if (view.prompts.some((p) => p.noteId === note.id)) return "needs you"
  if (note.held) return "waiting to run"
  const quiet = quietSince(view, note)
  if (quiet !== null) return `no output ${Math.max(1, Math.round((now - quiet) / 60_000))}m`
  switch (note.status) {
    case "draft":
      return "draft"
    case "queued":
      return "queued"
    case "running":
      return "running"
    case "blocked":
      return "blocked"
    case "review":
      return "review"
    case "failed":
      // "interrupted", "cancelled" or "failed": each asks something different.
      return failureOf(runOf(view, note)).kind
    case "done":
      return note.outcome === "discarded" ? "discarded" : "merged"
  }
}

export type CardText = { title: [string, string]; meta: Seg[] }

/**
 * A card's words, fitted to `inner` cells: two lines of title (the second
 * ending in … when it goes on), then the state, the agent, the diff and a clock.
 */
export function cardText(
  view: BoardView,
  note: Note,
  inner: number,
  now: number,
  tick: number,
  opts: { hub: boolean; runners: readonly RunnerInfo[] } = { hub: false, runners: [] },
): CardText {
  const w = Math.max(4, inner)
  const lines = wrap(note.title.replace(/\s+/g, " ").trim(), w)
  const first = lines[0] ?? ""
  // Two lines of title; the second ends in … when the title goes on.
  const second = lines.length > 2 ? truncate(lines.slice(1).join(" "), w) : (lines[1] ?? "")
  const g = glyph(view, note, tick)
  const state: Seg = { text: `${g.char} ${stateWord(view, note, now)}`, tone: g.tone === "plain" ? "dim" : g.tone, bold: g.tone === "lemon" }

  // Details, right-aligned, each a unit that is shown whole or not at all.
  // The clock is last in the list and last to be dropped when space is short.
  const units: Seg[][] = []
  if (diffstat(note) && note.stat)
    units.push([{ text: `+${note.stat.insertions}`, tone: "mint" }, { text: ` −${note.stat.deletions}`, tone: "berry" }])
  if (note.agent) units.push([{ text: note.agent, tone: "dim" }])
  if (opts.hub) {
    const m = machineName(opts.runners, note.held?.runnerId ?? note.runner)
    if (m) units.push([{ text: `@${m}`, tone: note.held ? "lemon" : "dim" }])
  }
  units.push([{ text: noteClock(view, note, now), tone: "dim" }])
  const widthOf = (us: Seg[][]) => us.reduce((n, u) => n + u.reduce((m, s) => m + textWidth(s.text), 0), 0) + Math.max(0, us.length - 1)
  const room = w - textWidth(state.text) - 1
  while (units.length > 0 && widthOf(units) > room) units.shift()
  const out: Seg[] = [state, { text: " ".repeat(Math.max(1, w - textWidth(state.text) - widthOf(units))), tone: "plain" }]
  units.forEach((u, i) => {
    if (i > 0) out.push({ text: " ", tone: "plain" })
    out.push(...u)
  })
  return { title: [first, second], meta: out }
}

export function toneOfPaper(p: Paper): Tone {
  switch (p) {
    case "needs":
      return "lemon"
    case "running":
      return "cyan"
    case "review":
      return "mint"
    case "failed":
      return "berry"
    default:
      return "dim"
  }
}
