import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createWorktree } from "../dist/worktree.js"
import { findReclaimable, heldBack, humanBytes, reclaim, walkSize } from "../dist/gc.js"

// Windows has no `du`. A size of nothing reads as "nothing to reclaim", so
// gc walks the tree itself there.
test("a tree's size is counted without du", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-size-"))
  writeFileSync(path.join(dir, "a"), "x".repeat(1000))
  mkdirSync(path.join(dir, "deep", "er"), { recursive: true })
  writeFileSync(path.join(dir, "deep", "er", "b"), "y".repeat(500))
  assert.equal(await walkSize(dir), 1500)
})

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

/*
 * Trimming. The case that exposed this: two notes in review holding 810MB,
 * of which 801MB was node_modules and the turbo cache, while `kandy gc` said
 * "nothing to reclaim" because neither note was finished.
 */
import { mkdirSync } from "node:fs"
import { findStrippable, strip, takeStripped } from "../dist/gc.js"

/** A worktree carrying the kind of weight a real one does. */
async function heavy(dir, id) {
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.turbo/\n")
  commit(dir, "ignore build output")
  const wt = await createWorktree(dir, id, "work")
  mkdirSync(path.join(wt.path, "node_modules", "left-pad"), { recursive: true })
  writeFileSync(path.join(wt.path, "node_modules", "left-pad", "index.js"), "x".repeat(4096))
  mkdirSync(path.join(wt.path, ".turbo"), { recursive: true })
  writeFileSync(path.join(wt.path, ".turbo", "cache"), "y".repeat(4096))
  // Work in progress the trim must never touch.
  writeFileSync(path.join(wt.path, "feature.ts"), "export const done = false\n")
  return wt
}

test("a note in review keeps its checkout but loses its node_modules", async () => {
  const dir = repo()
  const wt = await heavy(dir, "note_review")
  const found = await findStrippable(dir, [note("note_review", { status: "review" })])

  assert.equal(found.length, 1)
  assert.deepEqual(found[0].dirs.sort(), [".turbo", "node_modules"])
  assert.ok(found[0].bytes > 0)

  strip(found[0])
  assert.equal(existsSync(path.join(wt.path, "node_modules")), false)
  assert.equal(existsSync(path.join(wt.path, ".turbo")), false)
  // The work is untouched: uncommitted changes survive, because they are not ignored.
  assert.equal(existsSync(path.join(wt.path, "feature.ts")), true)
})

test("a running note is never trimmed", async () => {
  // Pulling node_modules out from under an agent mid-run is the one outcome
  // here worse than wasting the disk.
  const dir = repo()
  await heavy(dir, "note_busy")
  for (const status of ["running", "queued", "blocked"]) {
    const found = await findStrippable(dir, [note("note_busy", { status })])
    assert.equal(found.length, 0, `${status} was trimmed`)
  }
})

test("a folder the repo commits is left alone even if it is called .cache", async () => {
  // Only ignored directories count as rebuildable. The name is not enough.
  const dir = repo()
  mkdirSync(path.join(dir, ".cache"), { recursive: true })
  writeFileSync(path.join(dir, ".cache", "keep.json"), "{}")
  commit(dir, "a committed cache")
  await createWorktree(dir, "note_cache", "work")
  const found = await findStrippable(dir, [note("note_cache", { status: "review" })])
  assert.equal(found.length, 0)
})

test("the runner is told to reinstall, exactly once", async () => {
  // Setup only runs on a fresh worktree, so a trimmed one would reach the next
  // agent with no dependencies. The marker says it needs its install back.
  const dir = repo()
  await heavy(dir, "note_once")
  const [item] = await findStrippable(dir, [note("note_once", { status: "failed" })])
  strip(item)
  assert.equal(takeStripped("note_once"), true)
  assert.equal(takeStripped("note_once"), false, "consumed by the first run that reinstalls")
})
