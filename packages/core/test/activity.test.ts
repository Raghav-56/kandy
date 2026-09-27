import test from "node:test"
import assert from "node:assert/strict"

import { activityActor, activityContext, activityPhrase, isTeamActivity } from "../dist/index.js"

const ev = (seq: number, type: string, data: Record<string, unknown>, actor = "alice@example.com") =>
  ({ seq, ts: 0, actor, type, data }) as never

test("what people did reads as sentences, and a new repo's columns aren't listed", () => {
  const events = [
    ev(5, "review.decided", { noteId: "n1", decision: "merge" }),
    ev(4, "note.created", { noteId: "n1", title: "Fix the flash" }),
    ev(3, "column.created", { columnId: "c1", name: "Inbox" }),
    ev(2, "board.created", { boardId: "b", name: "pomodoro" }),
    ev(1, "member.added", { email: "bob@example.com", role: "member" }),
  ]
  const shown = events.filter(isTeamActivity)
  assert.deepEqual(shown.map((e: { type: string }) => e.type), ["review.decided", "note.created", "board.created", "member.added"])
  // A note deleted since still has its title, from the event that made it.
  const ctx = activityContext(events, null, [])
  assert.equal(activityPhrase(shown[0]!, ctx), "merged «Fix the flash»")
  assert.equal(activityPhrase(shown[2]!, ctx), "added the repo pomodoro")
  assert.equal(activityPhrase(shown[3]!, ctx), "added bob@example.com as member")
})

test("a request to run on someone's machine is about the person who asked", () => {
  const held = ev(2, "note.held", { noteId: "n1", runnerId: "r1", requestedBy: "bob@example.com", agent: "claude" }, "alice@example.com")
  const placed = ev(1, "note.placed", { noteId: "n1", runnerId: "r1" }, "bob@example.com")
  const ctx = activityContext([held, placed], null, [{ runnerId: "r1", name: "alice-laptop" } as never])
  assert.equal(activityActor(held), "bob@example.com")
  assert.equal(activityPhrase(held, ctx), "asked to run «a note» on alice-laptop")
  assert.equal(activityActor(placed), "bob@example.com")
  assert.equal(activityPhrase(placed, ctx), "gave «a note» to alice-laptop")
})
