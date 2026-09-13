import test from "node:test"
import assert from "node:assert/strict"

import {
  coerceAttribution,
  commitTrailers,
  prBody,
  withTrailers,
} from "../dist/attribution.js"

test("trailers name the note, the run, the agent and the model", () => {
  assert.deepEqual(
    commitTrailers({
      noteId: "note_abc",
      runId: "run_xyz",
      agent: "claude",
      model: "opus",
    }),
    [
      "Kandy-Note: note_abc",
      "Kandy-Run: run_xyz",
      "Kandy-Agent: claude (opus)",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ],
  )
})

test("Co-Authored-By names the agent, never a person", () => {
  // The one rule that cannot bend: crediting a human for a diff they did not
  // write puts them in shortlog, blame and the contributor list under a claim
  // that is false.
  for (const agent of ["claude", "codex", "aider", "cursor", "opencode", "gemini", "grok"] as const) {
    const line = commitTrailers({ noteId: "n", agent }).find((l) =>
      l.startsWith("Co-Authored-By:"),
    )
    assert.ok(line, `${agent} should credit itself`)
    assert.match(line, /<noreply@[^>]+>$/, `${agent} must use a noreply address`)
  }
})

test("a trailer with nothing to say is left out, not left empty", () => {
  // An unknown model or an unassigned note must not write "Kandy-Agent: " into
  // history, where it is noise forever.
  assert.deepEqual(commitTrailers({ noteId: "note_1" }), ["Kandy-Note: note_1"])
  assert.deepEqual(commitTrailers({ noteId: "note_1", runId: null, agent: null }), [
    "Kandy-Note: note_1",
  ])
  assert.deepEqual(commitTrailers({ noteId: "note_1", agent: "codex", model: null }), [
    "Kandy-Note: note_1",
    "Kandy-Agent: codex",
    "Co-Authored-By: Codex <noreply@openai.com>",
  ])
})

test("trailer keys stay greppable, because that is the whole point", () => {
  // git log --format='%(trailers:key=Kandy-Note,valueonly)' is the reason for
  // using real trailers over prose. Renaming a key breaks every query written
  // against it, so this test exists to make that a deliberate act.
  const keys = commitTrailers({
    noteId: "n",
    runId: "r",
    agent: "claude",
    model: "opus",
  }).map((l) => l.slice(0, l.indexOf(":")))
  assert.deepEqual(keys, ["Kandy-Note", "Kandy-Run", "Kandy-Agent", "Co-Authored-By"])
})

test("withTrailers separates the subject with a blank line, and adds nothing when empty", () => {
  assert.equal(withTrailers("kandy: merge x", []), "kandy: merge x")
  assert.equal(
    withTrailers("kandy: merge x", ["Kandy-Note: n"]),
    "kandy: merge x\n\nKandy-Note: n",
  )
})

test("with the footer off, a PR body is the note's prompt and nothing else", () => {
  const body = prBody({ body: "Fix the thing.", agent: "claude" }, { footer: false, model: "opus" })
  assert.equal(body, "Fix the thing.")
  assert.ok(!body.includes("kandy"), "an opted-out board leaves no trace in the PR")
})

test("with the footer on, a reviewer gets the brief, the agent and the model", () => {
  const body = prBody({ body: "Fix the thing.", agent: "claude" }, { footer: true, model: "opus" })
  assert.match(body, /^Fix the thing\./)
  assert.match(body, /claude/)
  assert.match(body, /opus/)
  assert.match(body, /kandy/)
})

test("the PR footer never links to the board", () => {
  // The board is http://127.0.0.1:4477 on one laptop. A link only the author
  // can open is worse than no link: it reads as a reference and resolves to a
  // connection error.
  const body = prBody({ body: "x", agent: "claude" }, { footer: true, model: "opus" })
  assert.ok(!body.includes("127.0.0.1"))
  assert.ok(!body.includes("localhost"))
  assert.ok(!body.includes("4477"))
})

test("an empty note body still says something", () => {
  assert.match(prBody({ body: "   ", agent: null }, { footer: false }), /No description given/)
})

test("attribution coerces to off for anything that is not an explicit yes", () => {
  // A half-sent object must resolve to off for the key it omitted. Writing
  // history because a field was undefined is not a mistake worth allowing.
  assert.deepEqual(coerceAttribution(undefined), { commit: false, pr: false })
  assert.deepEqual(coerceAttribution(null), { commit: false, pr: false })
  assert.deepEqual(coerceAttribution({}), { commit: false, pr: false })
  assert.deepEqual(coerceAttribution({ commit: "yes" }), { commit: false, pr: false })
  assert.deepEqual(coerceAttribution({ commit: 1, pr: 1 }), { commit: false, pr: false })
  assert.deepEqual(coerceAttribution({ pr: true }), { commit: false, pr: true })
  assert.deepEqual(coerceAttribution({ commit: true, pr: true }), { commit: true, pr: true })
})
