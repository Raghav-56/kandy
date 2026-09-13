import test from "node:test"
import assert from "node:assert/strict"

import { notesIn, reduce, reduceAll } from "../dist/reduce.js"
import type { BoardView } from "../dist/domain.js"
import type { KandyEvent, PendingEvent } from "../dist/events.js"

const BOARD = "board_1"

function view(): BoardView {
  return {
    board: {
      id: BOARD,
      name: "test",
      repoPath: "/tmp/test",
      setup: null,
      carry: [],
      models: {},
      defaultPolicy: "repo",
      attribution: { commit: false, pr: false },
      createdAt: 0,
    },
    columns: [],
    notes: [],
    runs: [],
    seq: 0,
  }
}

let seq = 0
/** Stamp a pending event the way the store would. */
function ev<T extends PendingEvent>(pending: T): KandyEvent {
  seq += 1
  return { ...pending, seq, ts: 1000 + seq } as KandyEvent
}

function withNote(): { v: BoardView; noteId: string } {
  const noteId = "note_1"
  const v = reduceAll(view(), [
    ev({ type: "column.created", data: { columnId: "col_1", boardId: BOARD, name: "Inbox", pos: "a", lane: "inbox" } }),
    ev({ type: "note.created", data: { noteId, boardId: BOARD, columnId: "col_1", title: "T", body: "B", pos: "a" } }),
  ])
  return { v, noteId }
}

test("a created note starts as a draft with no run", () => {
  const { v, noteId } = withNote()
  const note = v.notes.find((n) => n.id === noteId)!
  assert.equal(note.status, "draft")
  assert.equal(note.runId, null)
  assert.equal(note.model, null)
  assert.equal(note.policy, "repo")
})

test("a note inherits the board's default policy, and only from then on", () => {
  const before = reduceAll(view(), [
    ev({ type: "column.created", data: { columnId: "col_1", boardId: BOARD, name: "Inbox", pos: "a", lane: "inbox" } }),
    ev({ type: "note.created", data: { noteId: "note_before", boardId: BOARD, columnId: "col_1", title: "T", body: "", pos: "a" } }),
  ])
  assert.equal(before.notes[0]!.policy, "repo")

  const after = reduceAll(before, [
    ev({ type: "board.policy", data: { boardId: BOARD, defaultPolicy: "full" } }),
    ev({ type: "note.created", data: { noteId: "note_after", boardId: BOARD, columnId: "col_1", title: "T", body: "", pos: "b" } }),
  ])
  assert.equal(after.board.defaultPolicy, "full")
  // The one written first keeps what it had: the setting applies forward.
  assert.equal(after.notes.find((n) => n.id === "note_before")!.policy, "repo")
  assert.equal(after.notes.find((n) => n.id === "note_after")!.policy, "full")

  // And a note can still disagree with its board.
  const pinned = reduce(after, ev({ type: "note.policy", data: { noteId: "note_after", policy: "repo" } }))
  assert.equal(pinned.notes.find((n) => n.id === "note_after")!.policy, "repo")
})

test("a run carries the note through queued, running and review", () => {
  const { v, noteId } = withNote()
  const runId = "run_1"

  const queued = reduce(v, ev({ type: "run.requested", data: { runId, noteId, agent: "claude" } }))
  assert.equal(queued.notes[0]!.status, "queued")
  assert.equal(queued.notes[0]!.agent, "claude")

  const running = reduce(
    queued,
    ev({
      type: "run.started",
      data: { runId, noteId, worktree: "/wt", branch: "b", baseRef: "abc", pid: 1 },
    }),
  )
  assert.equal(running.notes[0]!.status, "running")
  assert.equal(running.notes[0]!.branch, "b")

  const done = reduce(
    running,
    ev({ type: "run.finished", data: { runId, noteId, status: "succeeded", exitCode: 0, error: null } }),
  )
  // Success means review, not done: a human decides done.
  assert.equal(done.notes[0]!.status, "review")
})

test("a failed run marks the note failed, not done", () => {
  const { v, noteId } = withNote()
  const runId = "run_1"
  const after = reduceAll(v, [
    ev({ type: "run.requested", data: { runId, noteId, agent: "codex" } }),
    ev({ type: "run.finished", data: { runId, noteId, status: "failed", exitCode: 1, error: "boom" } }),
  ])
  assert.equal(after.notes[0]!.status, "failed")
  assert.equal(after.runs[0]!.error, "boom")
})

test("metrics accumulate across turns rather than overwrite", () => {
  // Claude reports a cumulative num_turns once; Codex reports turns:1 on every
  // turn. Summing is right for both — replacing made every Codex run read "1".
  const { v, noteId } = withNote()
  const runId = "run_1"
  const after = reduceAll(v, [
    ev({ type: "run.requested", data: { runId, noteId, agent: "codex" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: null, tokens: 100, turns: 1, model: "m", source: "estimated" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: null, tokens: 250, turns: 1, model: "m", source: "estimated" } }),
  ])
  const run = after.runs[0]!
  assert.equal(run.tokens, 350)
  assert.equal(run.turns, 2)
  assert.equal(run.model, "m")
})

test("a run that was ever estimated stays estimated", () => {
  // Mixing a reported figure with a computed one and calling the total exact
  // would be the dishonest half of both.
  const { v, noteId } = withNote()
  const runId = "run_1"
  const after = reduceAll(v, [
    ev({ type: "run.requested", data: { runId, noteId, agent: "codex" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: 1, tokens: 10, turns: 1, source: "reported" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: 2, tokens: 10, turns: 1, source: "estimated" } }),
  ])
  assert.equal(after.runs[0]!.costSource, "estimated")
  assert.equal(after.runs[0]!.costUsd, 3)
})

test("unpriced never downgrades a run that was priced", () => {
  const { v, noteId } = withNote()
  const runId = "run_1"
  const after = reduceAll(v, [
    ev({ type: "run.requested", data: { runId, noteId, agent: "claude" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: 1, tokens: 10, turns: 1, source: "reported" } }),
    ev({ type: "run.metrics", data: { runId, costUsd: null, tokens: 5, turns: 1, source: "unpriced" } }),
  ])
  assert.equal(after.runs[0]!.costSource, "reported")
})

test("blocked and unblocked move the note both ways", () => {
  const { v, noteId } = withNote()
  const runId = "run_1"
  const blocked = reduceAll(v, [
    ev({ type: "run.requested", data: { runId, noteId, agent: "claude" } }),
    ev({ type: "run.started", data: { runId, noteId, worktree: "/wt", branch: "b", baseRef: "a", pid: 1 } }),
    ev({ type: "run.blocked", data: { runId, requestId: "r", kind: "permission", detail: "nope" } }),
  ])
  assert.equal(blocked.notes[0]!.status, "blocked")

  const back = reduce(
    blocked,
    ev({ type: "run.unblocked", data: { runId, requestId: "r", decision: "allow" } }),
  )
  assert.equal(back.notes[0]!.status, "running")
})

test("review.opened records the diff size on the note", () => {
  const { v, noteId } = withNote()
  const after = reduce(
    v,
    ev({
      type: "review.opened",
      data: { noteId, runId: "run_1", branch: "b", stat: { files: 2, insertions: 10, deletions: 3 } },
    }),
  )
  assert.deepEqual(after.notes[0]!.stat, { files: 2, insertions: 10, deletions: 3 })
})

test("a stat from the old string format is discarded, not displayed", () => {
  // The log is immutable, so readers absorb history rather than migrate it.
  const { v, noteId } = withNote()
  const after = reduce(
    v,
    ev({
      type: "review.opened",
      data: { noteId, runId: "run_1", branch: "b", stat: " 2 files changed" as never },
    }),
  )
  assert.equal(after.notes[0]!.stat, null)
})

test("deleting a note removes it", () => {
  const { v, noteId } = withNote()
  const after = reduce(v, ev({ type: "note.deleted", data: { noteId } }))
  assert.equal(after.notes.length, 0)
})

test("events for another board are ignored but still advance seq", () => {
  const { v } = withNote()
  const before = v.notes.length
  const after = reduce(
    v,
    ev({ type: "note.created", data: { noteId: "x", boardId: "other", columnId: "c", title: "t", body: "", pos: "a" } }),
  )
  assert.equal(after.notes.length, before)
  // A client must not re-request a range it has already seen.
  assert.ok(after.seq > v.seq)
})

test("notes sort by position, then stably by id", () => {
  const { v } = withNote()
  const more = reduceAll(v, [
    ev({ type: "note.created", data: { noteId: "note_3", boardId: BOARD, columnId: "col_1", title: "C", body: "", pos: "c" } }),
    ev({ type: "note.created", data: { noteId: "note_2", boardId: BOARD, columnId: "col_1", title: "B", body: "", pos: "b" } }),
  ])
  assert.deepEqual(
    notesIn(more, "col_1").map((n) => n.title),
    ["T", "B", "C"],
  )
})
