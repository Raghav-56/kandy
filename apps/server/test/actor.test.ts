import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Store } from "../dist/store.js"

/*
 * Who did a thing.
 *
 * Nothing reads `actor` yet — the hub that will stamp it does not exist. It
 * goes in now because it is an envelope field on an append-only log: adding it
 * to a schema nobody has filled costs a column, and adding it to one people
 * have been using for months costs a migration over data that can never be
 * back-filled, because the answer was never recorded.
 */

function freshFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "kandy-actor-")), "test.db")
}

const board = {
  type: "board.created",
  data: { boardId: "board_1", name: "kandy", repoPath: "/tmp/repo" },
} as never

test("an event remembers who asked for it, across a reopen", () => {
  const file = freshFile()
  const store = new Store(file)
  const e = store.append(board, 1000, "alice@example.com")
  assert.equal(e.actor, "alice@example.com")
  store.close()

  // Read back by a different process's worth of state, which is the case that
  // matters: the value has to be in the row, not in the returned object.
  const reopened = new Store(file)
  assert.equal(reopened.since(0)[0]!.actor, "alice@example.com")
  reopened.close()
})

test("a single-player daemon records nobody, rather than inventing someone", () => {
  const store = new Store(freshFile())
  const e = store.append(board)
  // Not "system", not "local". There is nobody to distinguish from anybody,
  // and an event attributed to a fictitious robot reads as a fact.
  assert.equal(e.actor, null)
  assert.equal(store.since(0)[0]!.actor, null)
  store.close()
})

test("both readers carry it, because they used to be two copies of one mapping", () => {
  const store = new Store(freshFile())
  store.append(board, 1000, "alice@example.com")
  assert.equal(store.since(0)[0]!.actor, "alice@example.com")
  assert.equal(store.locallyAuthored(0)[0]!.actor, "alice@example.com")
  store.close()
})

test("work pulled from a teammate is attributed to the teammate, not the puller", () => {
  const store = new Store(freshFile())
  const e = store.appendShared(board, "their-device", 7, 1000, "bob@example.com")
  assert.equal(e!.actor, "bob@example.com")
  // The same reason the origin timestamp is preserved: the board should say
  // when Bob did it and that Bob did it, not that we happened to fetch it.
  assert.equal(e!.ts, 1000)
  store.close()
})

test("a log written before actor existed opens, and keeps its events", () => {
  const file = freshFile()

  // The schema exactly as it shipped, so this is the real upgrade and not a
  // rehearsal of it. `CREATE TABLE IF NOT EXISTS` does nothing to a table that
  // is already there, so without the ALTER this insert's table has no column
  // for the next append to write to.
  const old = new DatabaseSync(file)
  old.exec(`
    CREATE TABLE events (
      seq   INTEGER PRIMARY KEY AUTOINCREMENT,
      ts    INTEGER NOT NULL,
      type  TEXT    NOT NULL,
      data  TEXT    NOT NULL
    );
  `)
  old
    .prepare("INSERT INTO events (ts, type, data) VALUES (?, ?, ?)")
    .run(500, "board.created", JSON.stringify({ boardId: "board_0", name: "old", repoPath: "/x" }))
  old.close()

  const store = new Store(file)
  const events = store.since(0)
  assert.equal(events.length, 1)
  // Unattributed, and it stays that way. Nobody recorded who, and guessing now
  // would be worse than the null.
  assert.equal(events[0]!.actor, null)
  assert.equal(events[0]!.data.boardId, "board_0")

  // And the upgraded table takes new attributed events alongside the old ones.
  store.append(board, 1000, "alice@example.com")
  assert.deepEqual(
    store.since(0).map((e) => e.actor),
    [null, "alice@example.com"],
  )
  store.close()
})

test("opening twice does not try to add the column twice", () => {
  const file = freshFile()
  new Store(file).close()
  // An ALTER TABLE that is not guarded throws "duplicate column name" here.
  const again = new Store(file)
  assert.equal(again.append(board, 1000, "alice@example.com").actor, "alice@example.com")
  again.close()
})
