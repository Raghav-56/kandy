import test from "node:test"
import assert from "node:assert/strict"

import { LANE_OF, promptFor } from "../dist/domain.js"
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
