import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createWorktree } from "../dist/worktree.js"
import { findReclaimable, heldBack, humanBytes, reclaim } from "../dist/gc.js"

/** A real repository, because the thing under test is git behaviour. */
function repo() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-gc-")))
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@t")
  git("config", "user.name", "t")
  writeFileSync(path.join(dir, "README.md"), "# demo\n")
  git("add", "-A")
  git("commit", "-qm", "init")
  return dir
}

const commit = (cwd, msg) => {
  execFileSync("git", ["add", "-A"], { cwd })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", msg], { cwd })
}

const note = (id, over = {}) => ({
  id,
  title: `note ${id}`,
  status: "done",
  outcome: "merged",
  branch: null,
  worktree: null,
  ...over,
})

test("only finished notes are reclaimable", async () => {
  const dir = repo()
  const done = await createWorktree(dir, "note_done", "finished thing")
  const live = await createWorktree(dir, "note_live", "still going")

  const found = await findReclaimable(dir, [
    note("note_done"),
    note("note_live", { status: "running" }),
  ])

  assert.deepEqual(
    found.map((f) => f.noteId),
    ["note_done"],
  )
  assert.equal(found[0].path, done.path)
  assert.equal(found[0].branch, done.branch)
  // A worktree still being worked in is the whole point of the worktree.
  assert.equal(existsSync(live.path), true)
})

test("a note kandy has never heard of is left alone", async () => {
  // Another board on the same repo, or a note this view hasn't loaded. Not
  // ours to delete either way.
  const dir = repo()
  await createWorktree(dir, "note_stranger", "someone else's")
  assert.deepEqual(await findReclaimable(dir, [note("note_other")]), [])
})

test("an orphan is reclaimed only once no board claims it", async () => {
  // The distinction the whole check turns on. A worktree whose note this board
  // has never heard of may belong to another board on the same repo — possibly
  // running right now — so "unknown here" is not evidence. "Unknown to every
  // board" is, and only the caller can say that.
  const dir = repo()
  const wt = await createWorktree(dir, "note_orphan", "deleted note's work")

  // No `known` set: nothing unidentified is touched, which is the old
  // behaviour and the safe default.
  assert.deepEqual(await findReclaimable(dir, [note("note_other")]), [])

  // Another board still claims it — hands off.
  const claimed = await findReclaimable(dir, [note("note_other")], new Set(["note_orphan"]))
  assert.deepEqual(claimed, [])

  // Nobody claims it: ours, and finished with.
  const [item] = await findReclaimable(dir, [note("note_other")], new Set(["note_other"]))
  assert.ok(item, "an unclaimed orphan is reclaimable")
  assert.equal(item.noteId, "note_orphan")
  assert.ok(item.bytes > 0)

  await reclaim(dir, item, true)
  assert.equal(existsSync(wt.path), false)
  // The branch is the work and outlives the checkout, same as every other path.
  const branches = execFileSync("git", ["branch", "--list", wt.branch], { cwd: dir }).toString()
  assert.ok(branches.includes(wt.branch))
})

test("a merged worktree is reclaimed and its branch survives", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_m", "landed work")
  writeFileSync(path.join(wt.path, "ADDED.md"), "hi\n")
  commit(wt.path, "add")
  execFileSync("git", ["merge", "--no-ff", "-m", "merge", wt.branch], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })

  const [item] = await findReclaimable(dir, [note("note_m")])
  assert.equal(item.unmerged, 0)
  assert.equal(item.dirty, false)
  assert.equal(heldBack(item, false), null)
  assert.ok(item.bytes > 0)

  await reclaim(dir, item, false)
  assert.equal(existsSync(wt.path), false)
  // The commits are the work. gc reclaims disk, not history.
  const branches = execFileSync("git", ["branch", "--list", wt.branch], { cwd: dir }).toString()
  assert.ok(branches.includes(wt.branch))
})

test("an unmerged branch is held back until --force", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_u", "discarded work")
  writeFileSync(path.join(wt.path, "SPIKE.md"), "an idea\n")
  commit(wt.path, "spike")

  const [item] = await findReclaimable(dir, [note("note_u", { outcome: "discarded" })])
  assert.equal(item.unmerged, 1)
  assert.match(heldBack(item, false), /1 commit/)
  assert.equal(heldBack(item, true), null)

  await reclaim(dir, item, true)
  assert.equal(existsSync(wt.path), false)
})

test("uncommitted work in a finished note's worktree is held back", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_d", "left dirty")
  writeFileSync(path.join(wt.path, "README.md"), "# demo\nedited by hand\n")

  const [item] = await findReclaimable(dir, [note("note_d")])
  assert.equal(item.dirty, true)
  assert.equal(heldBack(item, false), "uncommitted changes")
  assert.equal(heldBack(item, true), null)
  assert.equal(existsSync(wt.path), true)
})

test("sizes read as sizes", () => {
  assert.equal(humanBytes(0), "0 B")
  assert.equal(humanBytes(1024), "1.0 KB")
  assert.equal(humanBytes(1024 * 1024 * 5.5), "5.5 MB")
  assert.equal(humanBytes(1024 * 1024 * 512), "512 MB")
})
