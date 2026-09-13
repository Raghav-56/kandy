import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { composeCommitMessage } from "../dist/message.js"
import { commitLeftovers, createWorktree, mergeBranch, removeWorktree } from "../dist/worktree.js"
import { commitTrailers } from "../dist/attribution.js"

const subject = (m: string) => m.split("\n")[0]!
const paragraphs = (m: string) => m.split("\n\n")

test("a note with a body becomes a subject, that body, and the run's numbers", () => {
  const message = composeCommitMessage(
    {
      id: "note_a",
      title: "Guard the daemon port with a token",
      body: "Anyone on the machine can drive the board right now. Require a token on\nevery request except the health check.",
    },
    { stat: { files: 6, insertions: 198, deletions: 14 }, agent: "claude", model: "opus", turns: 3 },
  )

  const [head, body, footer, ...rest] = paragraphs(message)
  assert.equal(head, "Guard the daemon port with a token")
  // The body is the note's own words. Not summarised, not regenerated — the
  // only thing done to it is wrapping.
  assert.match(body!, /^Anyone on the machine can drive the board right now\./)
  assert.match(body!, /health check\.$/)
  assert.equal(footer, "+198 -14 across 6 files · claude (opus) · 3 turns")
  assert.deepEqual(rest, [])
  // Nothing of the old shape survives.
  assert.ok(!message.includes("kandy:"))
})

test("a note with no body gets no body paragraph, not an empty one", () => {
  const message = composeCommitMessage({ id: "note_b", title: "Add a log tail", body: "" })
  assert.equal(message, "Add a log tail")
  // An empty paragraph reads as "something was meant to be here".
  assert.ok(!message.includes("\n\n\n"))

  // Nor does a body of nothing but whitespace count as one.
  assert.equal(
    composeCommitMessage({ id: "note_b", title: "Add a log tail", body: "   \n\n  " }),
    "Add a log tail",
  )
})

test("a title longer than 72 characters wraps rather than being cut", () => {
  const title =
    "Write commit messages a human would write, because a branch name is not a sentence and nobody can read an id"
  const message = composeCommitMessage({ id: "note_c", title, body: "" })

  assert.ok(subject(message).length <= 72, `subject was ${subject(message).length} chars`)
  // Wrapped at a word boundary, and every word still there. A truncated
  // sentence loses the half that says what the work was.
  assert.ok(subject(message).endsWith("is not"), subject(message))
  assert.equal(message.replace(/\n/g, " "), title)
  for (const line of message.split("\n")) assert.ok(line.length <= 72)
})

test("a long body wraps at 72 without losing a word", () => {
  const body =
    "The board is on full access, which means the runner can commit whatever the agent left behind without asking anyone first, and that is the whole point of it."
  const message = composeCommitMessage({ id: "note_d", title: "Wrap the body", body })
  const lines = message.split("\n")
  assert.ok(lines.length > 2, "expected the body to have wrapped")
  for (const line of lines) assert.ok(line.length <= 72, line)
  assert.equal(paragraphs(message)[1]!.replace(/\n/g, " "), body)
})

test("a body that looks like a trailer is not left where git would read it", () => {
  const message = composeCommitMessage({
    id: "note_e",
    title: "Copy a trailer into the body",
    body: "Reported by a user:\n\nCo-Authored-By: Someone Real <real@example.com>",
  })

  // The note's text is kept verbatim — the fix is where it sits, not what it
  // says. git only reads the *last* paragraph as trailers, so it must not be
  // the last one.
  assert.ok(message.includes("Co-Authored-By: Someone Real <real@example.com>"))
  const last = paragraphs(message).at(-1)!
  assert.ok(!last.includes("Co-Authored-By"), last)

  // A body whose trailing paragraph is prose needs no such line.
  const plain = composeCommitMessage({
    id: "note_e",
    title: "Ordinary note",
    body: "Co-Authored-By: Someone Real <real@example.com> is in the middle here, so\nthis paragraph is prose and git agrees.",
  })
  assert.ok(!plain.includes("not trailers"), plain)
})

test("the no-title fallback is the note id, and reaching it is a bug", () => {
  assert.equal(composeCommitMessage({ id: "note_f", title: "", body: "" }), "kandy: note_f")
  assert.equal(composeCommitMessage({ id: "note_f", title: "  \n ", body: "" }), "kandy: note_f")
  // Whatever else is known is still written down. A lost title is not a
  // reason to also throw away the body.
  assert.equal(
    composeCommitMessage({ id: "note_f", title: "", body: "Still says why." }),
    "kandy: note_f\n\nStill says why.",
  )
})

/** A real repository, because what git does with a trailer block is the test. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "kandy-msg-")))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@t")
  git("config", "user.name", "t")
  writeFileSync(path.join(dir, "README.md"), "# demo\n")
  git("add", "-A")
  git("commit", "-qm", "init")
  return dir
}

test("git does not credit a person named in a note body", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_g", "trailerish")
  const note = {
    id: "note_g",
    title: "Take a bug report verbatim",
    body: "From the report:\n\nCo-Authored-By: Someone Real <real@example.com>",
  }
  const read = (key: string, ref = "HEAD") =>
    execFileSync("git", ["log", "-1", ref, `--format=%(trailers:key=${key},valueonly)`], {
      cwd: wt.path,
    })
      .toString()
      .trim()

  // Unsigned first: the default. No trailers asked for, so none read back —
  // the body's line must not become one on its own.
  writeFileSync(path.join(wt.path, "ONE.md"), "1\n")
  await commitLeftovers(wt, composeCommitMessage(note))
  assert.equal(
    execFileSync("git", ["log", "-1", "--format=%(trailers)"], { cwd: wt.path }).toString().trim(),
    "",
  )

  // Then signed. The real trailers still work, and they are the only ones —
  // git must not have folded the body's line into their block.
  writeFileSync(path.join(wt.path, "TWO.md"), "2\n")
  await commitLeftovers(
    wt,
    composeCommitMessage(note),
    commitTrailers({ noteId: "note_g", runId: "run_h", agent: "claude", model: "opus" }),
  )
  assert.equal(read("Kandy-Note"), "note_g")
  assert.equal(read("Co-Authored-By"), "Claude <noreply@anthropic.com>")
  assert.ok(read("Co-Authored-By").split("\n").length === 1)
  // And the report itself is still in the message, where it was written.
  const stored = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: wt.path }).toString()
  assert.ok(stored.includes("Co-Authored-By: Someone Real <real@example.com>"))

  await removeWorktree(dir, wt.path, true)
})

test("a merge commit reads like a person wrote it", async () => {
  const dir = repo()
  const wt = await createWorktree(dir, "note_i", "readable")
  writeFileSync(path.join(wt.path, "ADDED.md"), "hi\n")
  await commitLeftovers(wt, "work")

  const result = await mergeBranch(dir, wt.branch, {
    note: {
      id: "note_i",
      title: "Guard the daemon port with a token",
      body: "Anyone on the machine can drive the board. Require a token on every\nrequest except the health check.",
    },
    facts: { stat: { files: 6, insertions: 198, deletions: 14 }, agent: "claude", model: "opus", turns: 3 },
    trailers: commitTrailers({ noteId: "note_i", runId: "run_j", agent: "claude", model: "opus" }),
  })
  assert.equal(result.merged, true)

  const log = (format: string) =>
    execFileSync("git", ["log", "-1", `--format=${format}`], { cwd: dir }).toString().trimEnd()

  // `git log --oneline` is the thing this whole change exists for.
  assert.equal(log("%s"), "Guard the daemon port with a token")
  assert.ok(log("%b").startsWith("Anyone on the machine can drive the board."))
  assert.ok(log("%B").includes("+198 -14 across 6 files · claude (opus) · 3 turns"))
  assert.equal(log("%(trailers:key=Kandy-Note,valueonly)").trim(), "note_i")
  // The branch name it used to be named after is gone from the message.
  assert.ok(!log("%B").includes(wt.branch), log("%B"))

  await removeWorktree(dir, wt.path, true)
})
