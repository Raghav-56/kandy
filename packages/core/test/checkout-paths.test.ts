import test from "node:test"
import assert from "node:assert/strict"

import { shortenCheckoutPaths } from "../dist/index.js"

test("a path inside a note's checkout reads relative to it", () => {
  assert.equal(shortenCheckoutPaths("/Users/me/app/.kandy/worktrees/note_ab12/src/app.js"), "src/app.js")
  assert.equal(
    shortenCheckoutPaths("grep x /r/.kandy/worktrees/n1/src/a.js /r/.kandy/worktrees/n1/b.js"),
    "grep x src/a.js b.js",
  )
  // The checkout itself is "here".
  assert.equal(shortenCheckoutPaths("cd /r/.kandy/worktrees/n1 && ls"), "cd . && ls")
})

test("anything outside a checkout is left exactly as written", () => {
  assert.equal(shortenCheckoutPaths("/Users/me/app/src/app.js"), "/Users/me/app/src/app.js")
  assert.equal(shortenCheckoutPaths("npm test 2>&1 | tail -5"), "npm test 2>&1 | tail -5")
})
