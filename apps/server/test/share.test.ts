/**
 * SPIKE — two laptops, one note, a bare git remote between them.
 *
 * "Laptop A" and "laptop B" are two Store/Engine pairs on two temp databases
 * with two clones of one repo. Nothing is stubbed: the events really are
 * written as JSONL blobs, really are pushed to an orphan branch, and really
 * are read back with git plumbing.
 *
 * Findings written up in docs/12-spike-git-share.md.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Engine } from "../dist/engine.js"
import { Store } from "../dist/store.js"
import { Bus } from "../dist/bus.js"
import {
  deviceId,
  exportable,
  fetchLog,
  foldInto,
  portable,
  pushLog,
  repoKey,
} from "../dist/share.js"

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

function tmp(tag: string): string {
  return mkdtempSync(path.join(tmpdir(), `kandy-share-${tag}-`))
}

/** A bare "github" plus two clones of it, each with one commit of history. */
function twoClones() {
  const origin = tmp("origin")
  git(origin, "init", "--bare", "--initial-branch=main", ".")

  const seed = tmp("seed")
  git(seed, "init", "--initial-branch=main", ".")
  git(seed, "config", "user.email", "spike@example.com")
  git(seed, "config", "user.name", "spike")
  writeFileSync(path.join(seed, "README.md"), "# spike\n")
  git(seed, "add", "-A")
  git(seed, "commit", "-m", "first")
  git(seed, "remote", "add", "origin", origin)
  git(seed, "push", "origin", "main")

  const clone = (tag: string) => {
    const dir = tmp(tag)
    git(dir, "clone", origin, ".")
    git(dir, "config", "user.email", `${tag}@example.com`)
    git(dir, "config", "user.name", tag)
    return dir
  }
  return { origin, a: clone("a"), b: clone("b") }
}

/** One install: its own database, its own device id, its own board. */
function laptop(name: string, repoPath: string) {
  const state = tmp(`state-${name}`)
  const engine = new Engine(new Store(path.join(state, "kandy.db")), new Bus())
  const device = deviceId(state)
  const boardId = `board_${name}`

  engine.emit({
    type: "board.created",
    data: { boardId, name, repoPath, setup: null, carry: [], models: {} },
  } as never)
  // Each install seeds its own lanes, with its own random column ids. That
  // they differ between laptops is the point of the exercise.
  for (const [i, lane] of ["inbox", "queued", "running", "review", "done"].entries()) {
    engine.emit({
      type: "column.created",
      data: { columnId: `col_${name}_${lane}`, boardId, name: lane, lane, pos: `a${i}` },
    } as never)
  }
  return {
    name,
    device,
    repoPath,
    engine,
    boardId,
    view: () => engine.view(boardId)!,
    note: (t: string) => engine.view(boardId)!.notes.find((n) => n.title === t),
  }
}

type Laptop = ReturnType<typeof laptop>

async function push(l: Laptop, repo: string) {
  return pushLog(l.repoPath, "origin", l.device, exportable(l.engine, l.view(), l.device, repo))
}

async function pull(l: Laptop) {
  const files = await fetchLog(l.repoPath, "origin")
  let applied = 0
  for (const [origin, records] of files) {
    if (origin === l.device) continue // our own file; we wrote it
    applied += foldInto(l.engine, l.view(), records).applied
  }
  return applied
}

// ---------------------------------------------------------------------------

test("the wire format drops identifiers and paths that are true only here", () => {
  const dir = tmp("portable")
  git(dir, "init", "--initial-branch=main", ".")
  const l = laptop("solo", dir)

  l.engine.emit({
    type: "note.created",
    data: {
      noteId: "note_1",
      boardId: l.boardId,
      columnId: "col_solo_inbox",
      title: "t",
      body: "b",
      pos: "a0",
    },
  } as never)
  const created = l.engine.store.since(0).find((e) => e.type === "note.created")!
  const wire = portable(created, l.view())!

  assert.equal(wire["boardId"], undefined, "board id is per-install; must not travel")
  assert.equal(wire["columnId"], undefined, "column id is per-install; must not travel")
  assert.equal(wire["lane"], "inbox", "the lane travels instead — it is semantic")

  l.engine.emit({
    type: "run.started",
    data: {
      runId: "run_1",
      noteId: "note_1",
      worktree: "/Users/me/.kandy/worktrees/note_1",
      branch: "kandy/note_1",
      baseRef: "abc",
      pid: 4242,
    },
  } as never)
  const started = l.engine.store.since(0).find((e) => e.type === "run.started")!
  const wire2 = portable(started, l.view())!
  assert.equal(wire2["worktree"], undefined, "an absolute path is a lie on another machine")
  assert.equal(wire2["pid"], undefined, "a pid there is someone else's process")
  assert.equal(wire2["branch"], "kandy/note_1", "the branch is real on both — it gets pushed")

  l.engine.close()
})

test("a note handed from A to B lands on B's board, in B's own identifiers", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  A.engine.emit({
    type: "note.created",
    data: {
      noteId: "note_shared",
      boardId: A.boardId,
      columnId: "col_a_inbox",
      title: "fix the login flash",
      body: "it flashes white on reload",
      pos: "a0",
    },
  } as never)
  A.engine.emit({ type: "note.assigned", data: { noteId: "note_shared", agent: "claude" } } as never)

  const res = await push(A, repo)
  assert.equal(res.pushed, 2)

  assert.equal(await pull(B), 2)
  const onB = B.note("fix the login flash")
  assert.ok(onB, "the note arrived")
  assert.equal(onB.body, "it flashes white on reload")
  assert.equal(onB.agent, "claude")
  assert.equal(onB.boardId, B.boardId, "it belongs to B's board, not A's")
  assert.equal(onB.columnId, "col_b_inbox", "it is in B's Inbox column, not A's")

  A.engine.close()
  B.engine.close()
})

test("pulling twice changes nothing", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  A.engine.emit({
    type: "note.created",
    data: { noteId: "n1", boardId: A.boardId, columnId: "col_a_inbox", title: "x", body: "", pos: "a0" },
  } as never)
  await push(A, repo)

  assert.equal(await pull(B), 1)
  assert.equal(await pull(B), 0, "second pull is a no-op")
  assert.equal(await pull(B), 0)
  assert.equal(B.view().notes.length, 1, "not three copies of one note")

  A.engine.close()
  B.engine.close()
})

test("pushing twice appends nothing — the branch is its own watermark", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  A.engine.emit({
    type: "note.created",
    data: { noteId: "n1", boardId: A.boardId, columnId: "col_a_inbox", title: "x", body: "", pos: "a0" },
  } as never)
  assert.equal((await push(A, repo)).pushed, 1)
  assert.equal((await push(A, repo)).pushed, 0)
  assert.equal((await push(A, repo)).pushed, 0)

  await pull(B)
  assert.equal(B.view().notes.length, 1)

  A.engine.close()
  B.engine.close()
})

test("the full hand-back: A writes, B runs it, A sees the review", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  // A writes the note and hands it off.
  A.engine.emit({
    type: "note.created",
    data: {
      noteId: "note_hand",
      boardId: A.boardId,
      columnId: "col_a_inbox",
      title: "add a --json flag",
      body: "print port and db path",
      pos: "a0",
    },
  } as never)
  await push(A, repo)
  await pull(B)

  // B picks it up and runs it on their laptop, with their agent login.
  B.engine.emit({
    type: "run.requested",
    data: { runId: "run_b", noteId: "note_hand", agent: "codex" },
  } as never)
  B.engine.emit({
    type: "run.started",
    data: {
      runId: "run_b",
      noteId: "note_hand",
      worktree: "/Users/bee/.kandy/worktrees/note_hand",
      branch: "kandy/note_hand",
      baseRef: "deadbeef",
      pid: 999,
    },
  } as never)
  B.engine.emit({
    type: "run.finished",
    data: { runId: "run_b", noteId: "note_hand", status: "succeeded", exitCode: 0, error: null },
  } as never)
  B.engine.emit({
    type: "review.opened",
    data: {
      noteId: "note_hand",
      runId: "run_b",
      branch: "kandy/note_hand",
      stat: { files: 2, insertions: 40, deletions: 3 },
    },
  } as never)
  await push(B, repo)

  // A pulls and sees a finished note waiting for a verdict.
  await pull(A)
  const onA = A.note("add a --json flag")!
  assert.equal(onA.status, "review", "A sees it as reviewable")
  assert.equal(onA.branch, "kandy/note_hand", "and knows which branch to read")
  assert.equal(onA.worktree, "", "but not where it ran — that was B's disk")
  assert.deepEqual(onA.stat, { files: 2, insertions: 40, deletions: 3 })

  const runOnA = A.view().runs.find((r) => r.id === "run_b")!
  assert.equal(runOnA.agent, "codex", "A can see B ran it with a different agent")
  assert.equal(runOnA.status, "succeeded")

  // A merges. B pulls and agrees.
  A.engine.emit({
    type: "review.decided",
    data: { noteId: "note_hand", decision: "merge" },
  } as never)
  await push(A, repo)
  await pull(B)

  const finalB = B.note("add a --json flag")!
  assert.equal(finalB.status, "done")
  assert.equal(finalB.outcome, "merged")
  assert.equal(A.note("add a --json flag")!.status, "done")

  A.engine.close()
  B.engine.close()
})

test("a three-way push never conflicts, because no two devices write one file", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  // Both write without seeing each other first — the racy case.
  A.engine.emit({
    type: "note.created",
    data: { noteId: "na", boardId: A.boardId, columnId: "col_a_inbox", title: "from a", body: "", pos: "a0" },
  } as never)
  B.engine.emit({
    type: "note.created",
    data: { noteId: "nb", boardId: B.boardId, columnId: "col_b_inbox", title: "from b", body: "", pos: "a1" },
  } as never)

  await push(A, repo)
  // B's push is built on a ref that is now stale; it must rebuild, not merge.
  await push(B, repo)

  await pull(A)
  await pull(B)

  const titles = (l: Laptop) => l.view().notes.map((n) => n.title).sort()
  assert.deepEqual(titles(A), ["from a", "from b"])
  assert.deepEqual(titles(B), ["from a", "from b"], "both laptops see both notes")

  A.engine.close()
  B.engine.close()
})

test("sharing never touches the working tree or the branch you are on", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  const before = git(repoA, "rev-parse", "--abbrev-ref", "HEAD")
  A.engine.emit({
    type: "note.created",
    data: { noteId: "n1", boardId: A.boardId, columnId: "col_a_inbox", title: "x", body: "", pos: "a0" },
  } as never)
  await push(A, repo)
  await pull(A)

  assert.equal(git(repoA, "rev-parse", "--abbrev-ref", "HEAD"), before, "still on the same branch")
  assert.equal(git(repoA, "status", "--porcelain"), "", "working tree untouched")
  assert.equal(
    git(repoA, "branch", "--list", "kandy-log"),
    "",
    "the log ref is not a branch the user has to look at",
  )

  // And the log branch shares no history with the code branch, so kandy's
  // bookkeeping never shows up in `git log` on main.
  await pull(B)
  assert.throws(
    () => git(repoB, "merge-base", "--is-ancestor", "refs/kandy/log", "main"),
    "the log is an orphan — not reachable from main",
  )

  A.engine.close()
  B.engine.close()
})

test("concurrent edits to one note diverge — arrival order, not timestamp order", async () => {
  const { a: repoA, b: repoB } = twoClones()
  const repo = await repoKey(repoA)
  const A = laptop("a", repoA)
  const B = laptop("b", repoB)

  A.engine.emit({
    type: "note.created",
    data: { noteId: "n1", boardId: A.boardId, columnId: "col_a_inbox", title: "original", body: "", pos: "a0" },
  } as never)
  await push(A, repo)
  await pull(B)

  // Both rename it, neither having seen the other.
  A.engine.emit({ type: "note.edited", data: { noteId: "n1", title: "A's title" } } as never)
  B.engine.emit({ type: "note.edited", data: { noteId: "n1", title: "B's title" } } as never)
  await push(A, repo)
  await push(B, repo)
  await pull(A)
  await pull(B)

  // Each laptop applied the foreign edit last, so each ends on the other's
  // title. Recorded, not asserted as desirable: this is the limit of the
  // no-CRDT design, and why the claim is sequential handoff.
  assert.equal(A.note("B's title")?.id, "n1")
  assert.equal(B.note("A's title")?.id, "n1")
  assert.notEqual(
    A.view().notes[0]!.title,
    B.view().notes[0]!.title,
    "concurrent edits do not converge without a total order",
  )

  A.engine.close()
  B.engine.close()
})
