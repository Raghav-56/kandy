import test from "node:test"
import assert from "node:assert/strict"

import {
  CARD_H,
  HEADER_H,
  cardText,
  columnsThatFit,
  dropAction,
  dropIndex,
  hitTest,
  kanbanColumns,
  layout,
  moveFocus,
  paperOf,
  reconcileFocus,
} from "../dist/tui/kanban.js"
import { textWidth } from "../dist/tui/text.js"

const NOW = 1_700_000_000_000

function note(id: string, over: Record<string, unknown> = {}) {
  return {
    id, boardId: "b", columnId: "c0", title: `note ${id}`, body: "", status: "draft", pos: id,
    agent: null, model: null, policy: "repo", rules: [], runId: null, branch: null, worktree: null,
    stat: null, pr: null, outcome: null, runner: null, held: null, handoff: null,
    createdAt: NOW, updatedAt: NOW, ...over,
  }
}

/** The five lanes a new board gets, deliberately out of order: columns follow `pos`. */
function view(notes: unknown[], extra: Record<string, unknown> = {}) {
  const lanes = ["inbox", "queued", "running", "review", "done"]
  return {
    board: { id: "b", name: "demo", repoPath: "/r", models: {}, defaultPolicy: "repo" },
    columns: lanes.map((lane, i) => ({ id: `c${i}`, boardId: "b", name: lane[0]!.toUpperCase() + lane.slice(1), pos: `a${i}`, lane })).reverse(),
    notes,
    runs: [],
    prompts: [],
    seq: 5,
    ...extra,
  } as never
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

// --- columns and focus -------------------------------------------------------

test("every column, in board order, empty ones included", () => {
  const cols = kanbanColumns(view([note("a"), note("b", { columnId: "c3", status: "review" })]))
  assert.deepEqual(ids(cols), ["c0", "c1", "c2", "c3", "c4"])
  assert.deepEqual(ids(cols[0]!.notes), ["a"])
  assert.deepEqual(ids(cols[3]!.notes), ["b"])
  assert.equal(cols[2]!.notes.length, 0, "an empty Running column is shown")
})

test("a filter narrows cards but keeps the columns; strays get an Other column", () => {
  const v = view([note("a", { title: "fix README" }), note("b"), note("c", { columnId: "gone" })])
  const cols = kanbanColumns(v, "readme")
  assert.equal(cols.length, 5)
  assert.deepEqual(ids(cols[0]!.notes), ["a"])
  assert.deepEqual(ids(kanbanColumns(v).at(-1)!.notes), ["c"])
})

test("focus follows a card to its new column, and falls back sensibly", () => {
  const cols = kanbanColumns(view([note("a"), note("b", { columnId: "c2", status: "running" })]))
  assert.deepEqual(reconcileFocus(cols, { column: "c0", note: "b" }), { column: "c2", note: "b" })
  assert.deepEqual(reconcileFocus(cols, { column: "c4", note: "zz" }), { column: "c4", note: null })
  assert.deepEqual(reconcileFocus(cols, null), { column: "c0", note: "a" })
})

test("arrows: across columns the row is kept where it can be; up/down clamp", () => {
  const cols = kanbanColumns(view([note("a"), note("b"), note("c"), note("d", { columnId: "c1", status: "queued" })]))
  assert.deepEqual(moveFocus(cols, { column: "c0", note: "c" }, 1, 0), { column: "c1", note: "d" })
  assert.deepEqual(moveFocus(cols, { column: "c1", note: "d" }, 1, 0), { column: "c2", note: null }, "an empty column")
  assert.deepEqual(moveFocus(cols, { column: "c0", note: "a" }, -1, 0), { column: "c0", note: "a" }, "clamped at the edge")
  assert.deepEqual(moveFocus(cols, { column: "c0", note: "a" }, 0, 5), { column: "c0", note: "c" })
})

// --- geometry ----------------------------------------------------------------

test("as many columns as fit side by side, the focused one always on screen", () => {
  assert.equal(columnsThatFit(200, 5), 5)
  assert.equal(columnsThatFit(80, 5), 3)
  assert.equal(columnsThatFit(20, 5), 1)
  const cols = kanbanColumns(view([]))
  const l = layout({ cols, width: 80, height: 30, focus: { column: "c4", note: null }, first: 0, scroll: {} })
  assert.deepEqual(l.columns.map((c: { column: { id: string } }) => c.column.id), ["c2", "c3", "c4"])
  assert.equal(l.left, 2)
  assert.equal(l.right, 0)
  // Columns tile the width exactly, with one cell between each.
  const last = l.columns.at(-1)!
  assert.equal(last.x + last.w, 80)
})

test("a column scrolls just enough to keep the focused card in view", () => {
  const notes = Array.from({ length: 12 }, (_, i) => note(`n${String(i).padStart(2, "0")}`))
  const cols = kanbanColumns(view(notes))
  const height = HEADER_H + CARD_H * 4
  const l = layout({ cols, width: 130, height, focus: { column: "c0", note: "n09" }, first: 0, scroll: {} })
  const c0 = l.columns[0]!
  assert.equal(l.slots, 4)
  assert.equal(c0.scroll, 6)
  assert.deepEqual(c0.cards.map((c: { note: { id: string } }) => c.note.id), ["n06", "n07", "n08", "n09"])
  assert.equal(c0.above, 6)
  assert.equal(c0.below, 2)
})

test("a click lands on the card that was drawn there", () => {
  const cols = kanbanColumns(view([note("a"), note("b"), note("r", { columnId: "c3", status: "review" })]))
  const l = layout({ cols, width: 130, height: 40, focus: null, first: 0, scroll: {} })
  const second = l.columns[0]!.cards[1]!
  assert.deepEqual(hitTest(l, second.x + 2, second.y + 1), { kind: "card", column: "c0", note: "b" })
  const review = l.columns[3]!
  assert.deepEqual(hitTest(l, review.x, HEADER_H), { kind: "card", column: "c3", note: "r" })
  assert.deepEqual(hitTest(l, review.x, 0), { kind: "header", column: "c3" })
  assert.deepEqual(hitTest(l, review.x, 30), { kind: "column", column: "c3", index: 1 })
  // The gap between two columns is nothing.
  assert.equal(hitTest(l, l.columns[0]!.x + l.columns[0]!.w, 3), null)
})

test("a drop lands above a card in its top half, below it in its bottom half", () => {
  const cols = kanbanColumns(view([note("a"), note("b"), note("c")]))
  const l = layout({ cols, width: 130, height: 40, focus: null, first: 0, scroll: {} })
  assert.equal(dropIndex(l, "c0", HEADER_H + 0), 0)
  assert.equal(dropIndex(l, "c0", HEADER_H + CARD_H - 1), 1)
  assert.equal(dropIndex(l, "c0", HEADER_H + CARD_H * 2 + 1), 2)
  assert.equal(dropIndex(l, "c0", 39), 3)
})

// --- dropping ----------------------------------------------------------------

test("dropping reorders within a column, by neighbours", () => {
  const v = view([note("a"), note("b"), note("c")])
  const cols = kanbanColumns(v)
  const c = cols[0]!.notes[2]!
  assert.deepEqual(dropAction(cols, c, "c0", 0), { kind: "reorder", column: "c0", before: "a" })
  assert.deepEqual(dropAction(cols, cols[0]!.notes[0]!, "c0", 3), { kind: "reorder", column: "c0", after: "c" })
  assert.deepEqual(dropAction(cols, cols[0]!.notes[0]!, "c0", 2), { kind: "reorder", column: "c0", before: "c", after: "b" })
  assert.deepEqual(dropAction(cols, cols[0]!.notes[1]!, "c0", 1), { kind: "none" }, "dropped where it was")
})

test("dropping into a lifecycle column means the action that would put it there", () => {
  const v = view([note("d"), note("r", { columnId: "c3", status: "review" })])
  const cols = kanbanColumns(v)
  const draft = cols[0]!.notes[0]!
  const review = cols[3]!.notes[0]!
  assert.deepEqual(dropAction(cols, draft, "c2", 0), { kind: "run" })
  assert.deepEqual(dropAction(cols, draft, "c1", 0), { kind: "run" })
  assert.deepEqual(dropAction(cols, review, "c4", 0), { kind: "merge" })
  assert.equal(dropAction(cols, draft, "c4", 0).kind, "refuse", "a draft can't be dragged to Done")
  assert.equal(dropAction(cols, review, "c0", 0).kind, "refuse")
})

// --- cards -------------------------------------------------------------------

test("a card's paper says what state it's in", () => {
  const v = view(
    [note("q"), note("h", { held: { runnerId: "x", agent: "claude" } }), note("r", { status: "review" }), note("f", { status: "failed" }), note("g", { status: "running" })],
    { prompts: [{ noteId: "q", runId: "r1", requestId: "x", tool: "Bash", command: "ls" }] },
  )
  const byId = (id: string) => (v as { notes: { id: string }[] }).notes.find((n) => n.id === id)
  assert.equal(paperOf(v, byId("q") as never), "needs")
  assert.equal(paperOf(v, byId("h") as never), "needs")
  assert.equal(paperOf(v, byId("r") as never), "review")
  assert.equal(paperOf(v, byId("f") as never), "failed")
  assert.equal(paperOf(v, byId("g") as never), "running")
})

test("a card's text fits its width: two lines of title, then details that give way", () => {
  const long = note("n", {
    title: "Pause the timer when the tab is hidden and resume it when it becomes visible again",
    status: "review",
    agent: "claude",
    stat: { files: 1, insertions: 12, deletions: 0 },
  })
  const v = view([long])
  for (const inner of [20, 30, 44]) {
    const t = cardText(v, long as never, inner, NOW, 0)
    assert.ok(textWidth(t.title[0]) <= inner)
    assert.ok(textWidth(t.title[1]) <= inner)
    // At 44 it fits in exactly two lines; narrower, it goes on and says so.
    if (inner < 44) assert.ok(t.title[1].endsWith("…"), "the title went on")
    else assert.ok(!t.title[1].endsWith("…"))
    const metaW = t.meta.reduce((n: number, s: { text: string }) => n + textWidth(s.text), 0)
    assert.ok(metaW <= inner, `meta ${metaW} > ${inner}`)
    assert.ok(t.meta[0]!.text.includes("review"), "the state is never dropped")
  }
  const wide = cardText(v, long as never, 44, NOW, 0).meta.map((s: { text: string }) => s.text).join("")
  assert.match(wide, /\+12 −0 claude/)
})

test("a quiet run turns its card yellow and says for how long", () => {
  const n = note("q", { columnId: "c2", status: "running", agent: "opencode", runId: "r1" })
  const run = { id: "r1", noteId: "q", agent: "opencode", status: "running", startedAt: NOW - 300_000, quietSince: NOW - 180_000 }
  const v = view([n], { runs: [run] })
  assert.equal(paperOf(v, n as never), "needs")
  const meta = cardText(v, n as never, 40, NOW, 0).meta.map((s: { text: string }) => s.text).join("")
  assert.match(meta, /no output 3m/)
  // Talking again: back to an ordinary running card.
  const talking = view([n], { runs: [{ ...run, quietSince: null }] })
  assert.equal(paperOf(talking, n as never), "running")
})
