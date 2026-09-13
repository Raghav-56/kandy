import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe as describeFiles, saveAttachments } from "../dist/attach.js"

const b64 = (s: string) => Buffer.from(s).toString("base64")

test("an attachment lands in the worktree the agent is already in", () => {
  const wt = mkdtempSync(path.join(tmpdir(), "kandy-wt-"))
  const saved = saveAttachments(wt, [{ name: "shot.png", data: b64("pretend png") }])

  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.name, "shot.png")
  assert.equal(readFileSync(path.join(wt, saved[0]!.relPath), "utf8"), "pretend png")
  assert.equal(saved[0]!.bytes, "pretend png".length)
})

test("a crafted name cannot escape the worktree", () => {
  const wt = mkdtempSync(path.join(tmpdir(), "kandy-wt-"))
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
  const wt = mkdtempSync(path.join(tmpdir(), "kandy-wt-"))
  const [saved] = saveAttachments(wt, [{ name: ".env", data: b64("SECRET=1") }])
  assert.ok(saved)
  assert.ok(!path.basename(saved.relPath).startsWith("."), saved.relPath)
})

test("the agent is told what it was given, by path", () => {
  const text = describeFiles([{ name: "a.png", relPath: ".kandy-attachments/a.png", bytes: 2048 }])
  assert.match(text, /\.kandy-attachments\/a\.png/)
  assert.match(text, /2 KB/)
})

test("no attachments means nothing is appended to the message", () => {
  assert.equal(describeFiles([]), "")
})
