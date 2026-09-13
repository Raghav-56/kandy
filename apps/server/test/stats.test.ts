import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Store } from "../dist/store.js"
import { Projections } from "../dist/projection.js"
import { computeStats } from "../dist/stats.js"

function board() {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-stats-"))
  const store = new Store(path.join(dir, "s.db"))
  const projections = new Projections(store)
  const emit = (pending: unknown) => projections.apply(store.append(pending as never))

  emit({ type: "board.created", data: { boardId: "b", name: "demo", repoPath: "/r" } })
  emit({ type: "column.created", data: { columnId: "c", boardId: "b", name: "Inbox", pos: "a", lane: "inbox" } })
  return { store, projections, emit }
}

function note(emit: (p: unknown) => void, id: string, title: string) {
  emit({ type: "note.created", data: { noteId: id, boardId: "b", columnId: "c", title, body: "", pos: id } })
}

test("landed and discarded are told apart", () => {
  // Both verdicts leave a note `done`; an accept rate from status alone would
  // have counted every thrown-away branch as a success.
  const { store, projections, emit } = board()
  note(emit, "n1", "kept")
  note(emit, "n2", "binned")
  emit({ type: "review.decided", data: { noteId: "n1", decision: "merge" } })
  emit({ type: "review.decided", data: { noteId: "n2", decision: "discard" } })

  const s = computeStats(projections.view("b")!, store)
  assert.equal(s.notes.landed, 1)
  assert.equal(s.notes.discarded, 1)
  store.close()
})

test("a revise leaves the note open with no outcome", () => {
  const { store, projections, emit } = board()
  note(emit, "n1", "again")
  emit({ type: "review.decided", data: { noteId: "n1", decision: "revise", comment: "no" } })

  const view = projections.view("b")!
  assert.equal(view.notes[0]!.outcome, null)
  assert.equal(view.notes[0]!.status, "draft")
  assert.equal(computeStats(view, store).notes.landed, 0)
  store.close()
})

test("first-try counts only notes that landed without a second run", () => {
  const { store, projections, emit } = board()
  note(emit, "n1", "clean")
  note(emit, "n2", "took two goes")
  emit({ type: "run.requested", data: { runId: "r1", noteId: "n1", agent: "claude" } })
  emit({ type: "run.requested", data: { runId: "r2", noteId: "n2", agent: "claude" } })
  emit({ type: "run.requested", data: { runId: "r3", noteId: "n2", agent: "claude" } })
  emit({ type: "review.decided", data: { noteId: "n1", decision: "merge" } })
  emit({ type: "review.decided", data: { noteId: "n2", decision: "merge" } })

  const s = computeStats(projections.view("b")!, store)
  assert.deepEqual(s.firstTry, { landed: 1, of: 2 })
  store.close()
})

test("a total mixing reported and computed cost says so", () => {
  const { store, projections, emit } = board()
  note(emit, "n1", "x")
  emit({ type: "run.requested", data: { runId: "r1", noteId: "n1", agent: "claude" } })
  emit({ type: "run.metrics", data: { runId: "r1", costUsd: 1, tokens: 10, turns: 1, source: "reported" } })
  emit({ type: "run.requested", data: { runId: "r2", noteId: "n1", agent: "codex" } })
  emit({ type: "run.metrics", data: { runId: "r2", costUsd: 2, tokens: 20, turns: 1, source: "estimated" } })

  const s = computeStats(projections.view("b")!, store)
  assert.equal(s.spend.usd, 3)
  assert.equal(s.spend.estimated, true, "a mixed total must not claim to be exact")
  store.close()
})

test("empty boards produce nulls rather than zeroes that look like facts", () => {
  const { store, projections } = board()
  const s = computeStats(projections.view("b")!, store)
  assert.equal(s.linesPerDollar, null)
  assert.equal(s.tokensPerLine, null)
  assert.equal(s.runs.medianMs, null)
  assert.equal(s.priciest, null)
  assert.equal(s.busiestHour, null)
  assert.deepEqual(s.tools, [])
  store.close()
})

test("tool counts are grouped per run set", () => {
  const { store, projections, emit } = board()
  note(emit, "n1", "x")
  emit({ type: "run.requested", data: { runId: "r1", noteId: "n1", agent: "claude" } })
  store.appendTranscript("r1", "tool", "ls", "Bash")
  store.appendTranscript("r1", "tool", "cat x", "Bash")
  store.appendTranscript("r1", "tool", "edit", "Edit")
  // A different run's tools must not leak into this board's figures.
  store.appendTranscript("other", "tool", "noise", "Bash")

  const s = computeStats(projections.view("b")!, store)
  assert.deepEqual(s.tools, [{ tool: "Bash", calls: 2 }, { tool: "Edit", calls: 1 }])
  store.close()
})

test("per-agent figures split landed work by who ran it", () => {
  const { store, projections, emit } = board()
  note(emit, "n1", "a")
  note(emit, "n2", "b")
  emit({ type: "run.requested", data: { runId: "r1", noteId: "n1", agent: "claude" } })
  emit({ type: "run.requested", data: { runId: "r2", noteId: "n2", agent: "codex" } })
  emit({ type: "review.decided", data: { noteId: "n1", decision: "merge" } })
  emit({ type: "review.decided", data: { noteId: "n2", decision: "discard" } })

  const s = computeStats(projections.view("b")!, store)
  const claude = s.agents.find((a) => a.agent === "claude")!
  const codex = s.agents.find((a) => a.agent === "codex")!
  assert.equal(claude.landed, 1)
  assert.equal(claude.discarded, 0)
  assert.equal(codex.landed, 0)
  assert.equal(codex.discarded, 1)
  store.close()
})
