import test from "node:test"
import assert from "node:assert/strict"

import { LANE_OF, promptFor, splitPrompt } from "../dist/domain.js"
import { NOTE_STATUSES } from "../dist/domain.js"

test("promptFor gives the agent both the title and the detail", () => {
  assert.equal(
    promptFor({ title: "Fix the login flash", body: "It happens on reload." }),
    "Fix the login flash\n\nIt happens on reload.",
  )
})

test("promptFor never sends an empty prompt for a titled note", () => {
  // The bug this replaces: `body ?? title` kept "" because ?? only falls back
  // on null, so every single-line note told the agent nothing at all.
  assert.equal(promptFor({ title: "Fix the login flash", body: "" }), "Fix the login flash")
  assert.equal(promptFor({ title: "Fix it", body: "   " }), "Fix it")
})

test("promptFor tolerates a note with detail but no title", () => {
  assert.equal(promptFor({ title: "", body: "do the thing" }), "do the thing")
})

test("a pasted paragraph splits into a title and a detail", () => {
  // The bug: pasting this into a single-line title kept line one and dropped
  // the rest without saying so.
  assert.deepEqual(splitPrompt("Fix the login flash\nIt happens on reload.\nEvery time."), {
    title: "Fix the login flash",
    body: "It happens on reload.\nEvery time.",
  })
})

test("a single-line paste is all title and no detail", () => {
  assert.deepEqual(splitPrompt("Fix the login flash"), {
    title: "Fix the login flash",
    body: "",
  })
})

test("splitting is the inverse of the join promptFor does", () => {
  const note = { title: "Fix the login flash", body: "It happens on reload.\n\nOnly in Safari." }
  assert.deepEqual(splitPrompt(promptFor(note)), note)
})

test("a paste keeps its own paragraph breaks", () => {
  // Only the blank line promptFor would have inserted is eaten. Interior
  // spacing is the pasted text's own formatting.
  assert.deepEqual(splitPrompt("Title\n\nOne.\n\nTwo.\n"), {
    title: "Title",
    body: "One.\n\nTwo.",
  })
})

test("a paste from a Windows clipboard splits the same way", () => {
  assert.deepEqual(splitPrompt("Title\r\nBody line\r\nmore"), {
    title: "Title",
    body: "Body line\nmore",
  })
})

test("a paste that is only newlines yields an empty note, not a crash", () => {
  assert.deepEqual(splitPrompt("\n\n\n"), { title: "", body: "" })
  assert.deepEqual(splitPrompt(""), { title: "", body: "" })
})

test("every status maps to a lane", () => {
  for (const status of NOTE_STATUSES) {
    assert.ok(LANE_OF[status], `${status} has no lane`)
  }
})

test("blocked and failed sit beside work in flight, not filed away", () => {
  // A refusal is something to act on; burying it under "done" hides it.
  assert.equal(LANE_OF.blocked, "running")
  assert.equal(LANE_OF.failed, "review")
})
