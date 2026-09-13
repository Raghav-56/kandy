import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Store } from "../dist/store.js"
import { Projections } from "../dist/projection.js"

/** A store on a throwaway file, so tests never touch real state. */
function fresh(): { store: Store; projections: Projections } {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-test-"))
  const store = new Store(path.join(dir, "test.db"))
  return { store, projections: new Projections(store) }
}

function emit(store: Store, projections: Projections, pending: unknown) {
  const e = store.append(pending as never)
  projections.apply(e)
  return e
}

test("a board appears and can be read back", () => {
  const { store, projections } = fresh()
  emit(store, projections, {
    type: "board.created",
    data: { boardId: "b1", name: "demo", repoPath: "/tmp/demo", setup: "pnpm i", carry: [".env"] },
  })

  const view = projections.view("b1")
  assert.ok(view)
  assert.equal(view.board.name, "demo")
  assert.equal(view.board.setup, "pnpm i")
  assert.deepEqual(view.board.carry, [".env"])
  store.close()
})

test("a board signs nothing until it is asked to", () => {
  // Off by default, and a log written before attribution existed replays to
  // off — never to on, which would silently start editing someone's history.
  const { store, projections } = fresh()
  emit(store, projections, {
    type: "board.created",
    data: { boardId: "b1", name: "demo", repoPath: "/tmp/demo" },
  })
  assert.deepEqual(projections.view("b1")?.board.attribution, { commit: false, pr: false })

  // The two switches move independently: yes to a PR footer, no to trailers.
  emit(store, projections, {
    type: "board.attribution",
    data: { boardId: "b1", attribution: { commit: false, pr: true } },
  })
  assert.deepEqual(projections.view("b1")?.board.attribution, { commit: false, pr: true })

  emit(store, projections, {
    type: "board.attribution",
    data: { boardId: "b1", attribution: { commit: true, pr: false } },
  })
  assert.deepEqual(projections.view("b1")?.board.attribution, { commit: true, pr: false })
  store.close()
})

test("a note is found by id without searching every board", () => {
  const { store, projections } = fresh()
  emit(store, projections, { type: "board.created", data: { boardId: "b1", name: "a", repoPath: "/a" } })
  emit(store, projections, { type: "board.created", data: { boardId: "b2", name: "b", repoPath: "/b" } })
  emit(store, projections, {
    type: "column.created",
    data: { columnId: "c2", boardId: "b2", name: "Inbox", pos: "a", lane: "inbox" },
  })
  emit(store, projections, {
    type: "note.created",
    data: { noteId: "n1", boardId: "b2", columnId: "c2", title: "t", body: "", pos: "a" },
  })

  assert.equal(projections.boardOf("n1")?.board.id, "b2")
  assert.equal(projections.boardOf("missing"), null)
  store.close()
})

test("run events reach the right board even though they carry no boardId", () => {
  const { store, projections } = fresh()
  emit(store, projections, { type: "board.created", data: { boardId: "b1", name: "a", repoPath: "/a" } })
  emit(store, projections, {
    type: "column.created",
    data: { columnId: "c1", boardId: "b1", name: "Inbox", pos: "a", lane: "inbox" },
  })
  emit(store, projections, {
    type: "note.created",
    data: { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a" },
  })
  emit(store, projections, { type: "run.requested", data: { runId: "r1", noteId: "n1", agent: "claude" } })
  // run.session has neither a boardId nor a noteId — only the run.
  emit(store, projections, { type: "run.session", data: { runId: "r1", agentSessionId: "sess" } })

  assert.equal(projections.view("b1")!.runs[0]!.agentSessionId, "sess")
  store.close()
})

test("removing a board forgets it and its notes", () => {
  const { store, projections } = fresh()
  emit(store, projections, { type: "board.created", data: { boardId: "b1", name: "a", repoPath: "/a" } })
  emit(store, projections, {
    type: "column.created",
    data: { columnId: "c1", boardId: "b1", name: "Inbox", pos: "a", lane: "inbox" },
  })
  emit(store, projections, {
    type: "note.created",
    data: { noteId: "n1", boardId: "b1", columnId: "c1", title: "t", body: "", pos: "a" },
  })

  emit(store, projections, { type: "board.removed", data: { boardId: "b1" } })
  assert.equal(projections.view("b1"), null)
  assert.equal(projections.boardOf("n1"), null)
  assert.deepEqual(projections.boards(), [])
  store.close()
})

test("projections rebuild from the log alone", () => {
  // The log is the only source of truth; a restart must land in the same place.
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-test-"))
  const file = path.join(dir, "test.db")

  const store = new Store(file)
  const projections = new Projections(store)
  emit(store, projections, { type: "board.created", data: { boardId: "b1", name: "a", repoPath: "/a" } })
  emit(store, projections, {
    type: "column.created",
    data: { columnId: "c1", boardId: "b1", name: "Inbox", pos: "a", lane: "inbox" },
  })
  emit(store, projections, {
    type: "note.created",
    data: { noteId: "n1", boardId: "b1", columnId: "c1", title: "kept", body: "", pos: "a" },
  })
  store.close()

  const reopened = new Store(file)
  const rebuilt = new Projections(reopened)
  assert.equal(rebuilt.view("b1")!.notes[0]!.title, "kept")
  reopened.close()
})

test("the transcript is kept out of the domain log", () => {
  const { store } = fresh()
  store.appendTranscript("r1", "assistant", "hello")
  store.appendTranscript("r1", "tool", "ls", "Bash")
  // Board replay must not be proportional to how talkative the agents were.
  assert.equal(store.since(0).length, 0)
  const frames = store.transcriptSince("r1")
  assert.equal(frames.length, 2)
  assert.equal(frames[1]!.meta, "Bash")
  store.close()
})

test("transcript sequence is per run and dense", () => {
  const { store } = fresh()
  store.appendTranscript("r1", "assistant", "one")
  store.appendTranscript("r2", "assistant", "other run")
  store.appendTranscript("r1", "assistant", "two")
  assert.deepEqual(store.transcriptSince("r1").map((f) => f.seq), [1, 2])
  assert.deepEqual(store.transcriptSince("r1", 1).map((f) => f.text), ["two"])
  store.close()
})
