import test from "node:test"
import assert from "node:assert/strict"

import { noAgent } from "../dist/agents/hints.js"

test("with an agent installed but signed out, the sign-in for that one is named", () => {
  const why = noAgent([
    { id: "claude", installed: false },
    { id: "codex", installed: true },
  ])
  assert.equal(why.head, "no agent is signed in here")
  assert.match(why.next, /codex login/)
  assert.doesNotMatch(why.next, /claude/)
})

test("with nothing installed, it says so and offers the agent that needs no account", () => {
  const why = noAgent([
    { id: "claude", installed: false },
    { id: "codex", installed: false },
  ])
  assert.equal(why.head, "no agent is installed here")
  assert.match(why.next, /npm i -g opencode-ai/)
  assert.doesNotMatch(why.next, /sign in/)
})
