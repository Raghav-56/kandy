import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The staging area lives under the state dir, which paths.ts resolves once at
// import time — so it has to be pointed somewhere disposable before the module
// under test is loaded. Hence the dynamic import.
const STATE = mkdtempSync(path.join(tmpdir(), "kandy-state-"))
process.env["XDG_STATE_HOME"] = STATE

const {
  adoptStaged,
  clearStaged,
  describe: describeFiles,
  saveAttachments,
  stageAttachments,
  stagedFor,
  unstageAttachment,
} = await import("../dist/attach.js")

const b64 = (s: string) => Buffer.from(s).toString("base64")
/** A real PNG header, so the content sniffer sees an image. */
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
    .toString("base64")

const wtDir = () => mkdtempSync(path.join(tmpdir(), "kandy-wt-"))
let n = 0
const noteId = () => `note_test${n++}`

test("an attachment lands in the worktree the agent is already in", () => {
  const wt = wtDir()
  const saved = saveAttachments(wt, [{ name: "shot.png", data: b64("pretend png") }])

  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.name, "shot.png")
  assert.equal(readFileSync(path.join(wt, saved[0]!.relPath), "utf8"), "pretend png")
  assert.equal(saved[0]!.bytes, "pretend png".length)
})

test("a crafted name cannot escape the worktree", () => {
  const wt = wtDir()
  const saved = saveAttachments(wt, [
    { name: "../../etc/passwd", data: b64("nope") },
    { name: "/absolute/evil", data: b64("nope") },
  ])
  // Assert the invariant — every saved path resolves inside the worktree —
  // rather than the absence of some system file. The first version checked for
  // /etc/passwd, which exists for reasons nothing to do with this code, and so
  // failed wherever TMPDIR sat close enough to the root.
  const root = path.resolve(wt)
  for (const f of saved) {
    const target = path.resolve(wt, f.relPath)
    assert.ok(target.startsWith(root + path.sep), `${f.relPath} escaped to ${target}`)
    assert.ok(existsSync(target))
  }
})

test("a leading-dot name cannot become a dotfile", () => {
  const wt = wtDir()
  const [saved] = saveAttachments(wt, [{ name: ".env", data: b64("SECRET=1") }])
  assert.ok(saved)
  assert.ok(!path.basename(saved.relPath).startsWith("."), saved.relPath)
})

test("an attachment never rides the branch into the user's repo", () => {
  // The worktree is committed wholesale when a run ends, so the drop-off
  // directory has to exclude itself from git.
  const wt = wtDir()
  saveAttachments(wt, [{ name: "shot.png", data: png() }])
  assert.equal(readFileSync(path.join(wt, ".kandy-attachments", ".gitignore"), "utf8"), "*\n")
})

test("the agent is told what it was given, by path", () => {
  const text = describeFiles([{ name: "a.png", relPath: ".kandy-attachments/a.png", bytes: 2048 }])
  assert.match(text, /\.kandy-attachments\/a\.png/)
  assert.match(text, /2 KB/)
})

test("no attachments means nothing is appended to the message", () => {
  assert.equal(describeFiles([]), "")
})

// ---------------------------------------------------------------------------
// Staging: a note being composed has no worktree yet.
// ---------------------------------------------------------------------------

test("a composed note's files wait in the state dir, not in the user's repo", () => {
  const id = noteId()
  const { staged, rejected } = stageAttachments(id, [{ name: "shot.png", data: png() }])

  assert.deepEqual(rejected, [])
  assert.deepEqual(staged.map((f) => f.name), ["shot.png"])
  // Somewhere under the state dir, keyed by note id — and nowhere near a repo.
  const held = path.join(STATE, "kandy", "attachments", id, "shot.png")
  assert.ok(existsSync(held), `expected ${held}`)
})

test("staged files survive being read back later — a reload, or a restart", () => {
  const id = noteId()
  stageAttachments(id, [{ name: "shot.png", data: png() }])
  // Nothing in memory is consulted; this is a fresh read off disk.
  assert.deepEqual(stagedFor(id).map((f) => f.name), ["shot.png"])
})

test("a note with nothing staged reports nothing, rather than failing", () => {
  assert.deepEqual(stagedFor(noteId()), [])
})

test("an attachment can be taken back off before the note runs", () => {
  const id = noteId()
  stageAttachments(id, [
    { name: "one.png", data: png() },
    { name: "two.png", data: png() },
  ])
  assert.equal(unstageAttachment(id, "one.png"), true)
  assert.deepEqual(stagedFor(id).map((f) => f.name), ["two.png"])
  // Removing something that isn't there is not an error, just a no-op.
  assert.equal(unstageAttachment(id, "one.png"), false)
})

test("staging refuses a non-image binary, and says why", () => {
  const id = noteId()
  const bomb = Buffer.concat([Buffer.from("PK", "binary"), Buffer.alloc(32, 0)])
  const { staged, rejected } = stageAttachments(id, [
    { name: "archive.zip", data: bomb.toString("base64") },
    { name: "notes.txt", data: b64("a plain log line") },
  ])

  assert.deepEqual(staged.map((f) => f.name), ["notes.txt"])
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0]!.name, "archive.zip")
  assert.match(rejected[0]!.reason, /neither an image nor text/)
  assert.equal(existsSync(path.join(STATE, "kandy", "attachments", id, "archive.zip")), false)
})

test("staging refuses anything over the size cap, and says why", () => {
  const id = noteId()
  const huge = Buffer.alloc(9 * 1024 * 1024, 0x41) // 9MB of "A": valid text, too big
  const { staged, rejected } = stageAttachments(id, [
    { name: "huge.log", data: huge.toString("base64") },
  ])
  assert.deepEqual(staged, [])
  assert.match(rejected[0]!.reason, /9\.0MB — the limit is 8MB/)
})

test("a crafted name cannot escape the staging directory either", () => {
  const id = noteId()
  stageAttachments(id, [{ name: "../../../evil.png", data: png() }])
  const dir = path.join(STATE, "kandy", "attachments", id)
  for (const name of readdirSync(dir)) {
    assert.ok(
      path.resolve(dir, name).startsWith(path.resolve(dir) + path.sep),
      `${name} escaped the stage`,
    )
  }
  assert.equal(existsSync(path.join(STATE, "kandy", "attachments", "evil.png")), false)
})

test("the run moves staged files into the worktree and names them by relative path", () => {
  const id = noteId()
  const wt = wtDir()
  stageAttachments(id, [{ name: "shot.png", data: png() }])

  const adopted = adoptStaged(id, wt)
  assert.deepEqual(adopted.map((f) => f.relPath), [path.join(".kandy-attachments", "shot.png")])
  // The path handed to the agent must be openable from its cwd, which is the
  // worktree root. That is the whole contract.
  assert.ok(existsSync(path.resolve(wt, adopted[0]!.relPath)))
  assert.equal(adopted[0]!.bytes, Buffer.from(png(), "base64").byteLength)
  assert.match(describeFiles(adopted), /\.kandy-attachments\/shot\.png/)
})

test("adopting empties the stage, so a follow-up run does not re-announce the same file", () => {
  const id = noteId()
  const wt = wtDir()
  stageAttachments(id, [{ name: "shot.png", data: png() }])

  adoptStaged(id, wt)
  assert.deepEqual(stagedFor(id), [])
  // The file is still in the worktree where the agent left off; the second run
  // simply says nothing about it.
  assert.deepEqual(adoptStaged(id, wt), [])
})

test("a note with nothing staged adopts nothing and creates no directory", () => {
  const wt = wtDir()
  assert.deepEqual(adoptStaged(noteId(), wt), [])
  assert.equal(existsSync(path.join(wt, ".kandy-attachments")), false)
})

test("clearing a note takes its staged files with it", () => {
  const id = noteId()
  stageAttachments(id, [{ name: "shot.png", data: png() }])
  clearStaged(id)
  assert.deepEqual(stagedFor(id), [])
  // Twice is fine: a note deleted before it ever attached anything is normal.
  clearStaged(id)
})

test("a note id that did not come from us never becomes a path", () => {
  for (const bad of ["../../etc", "note/../..", "", "a".repeat(65)]) {
    assert.throws(() => stagedFor(bad), /bad note id/, `accepted ${JSON.stringify(bad)}`)
  }
})

test("staging is additive, so attaching twice keeps both", () => {
  const id = noteId()
  stageAttachments(id, [{ name: "one.png", data: png() }])
  stageAttachments(id, [{ name: "two.png", data: png() }])
  assert.deepEqual(stagedFor(id).map((f) => f.name), ["one.png", "two.png"])
})

test("two screenshots called image.png are two attachments, not one", () => {
  // Every browser names a pasted screenshot `image.png`.
  const id = noteId()
  stageAttachments(id, [{ name: "image.png", data: png() }])
  stageAttachments(id, [{ name: "image.png", data: png() }])
  assert.deepEqual(stagedFor(id).map((f) => f.name), ["image-2.png", "image.png"])

  const wt = wtDir()
  saveAttachments(wt, [
    { name: "image.png", data: png() },
    { name: "image.png", data: png() },
  ])
  const adopted = adoptStaged(id, wt)
  // Nothing overwrote anything, in the stage or in the worktree.
  assert.equal(new Set(adopted.map((f) => f.relPath)).size, adopted.length)
  for (const f of adopted) assert.ok(existsSync(path.resolve(wt, f.relPath)))
  assert.equal(readdirSync(path.join(wt, ".kandy-attachments")).length, 5) // 4 files + .gitignore
})

test("the staging cap is a refusal, not a silent drop", () => {
  const id = noteId()
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}.png`, data: png() }))
  const { staged, rejected } = stageAttachments(id, many)
  assert.equal(staged.length, 10)
  assert.equal(rejected.length, 2)
  assert.match(rejected[0]!.reason, /at most 10 files/)
})

test("the stage is read from disk, not from a manifest we might disagree with", () => {
  // A file that appeared in the stage by other means — an older daemon, a
  // hand-copy — is handed over too, rather than being invisible to the run.
  const id = noteId()
  stageAttachments(id, [{ name: "shot.png", data: png() }])
  writeFileSync(path.join(STATE, "kandy", "attachments", id, "stray.txt"), "hello")

  const wt = wtDir()
  const adopted = adoptStaged(id, wt)
  assert.deepEqual(adopted.map((f) => f.name), ["shot.png", "stray.txt"])
})
