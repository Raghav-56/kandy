import test from "node:test"
import assert from "node:assert/strict"
import { isAuthFailure } from "../dist/agent-auth.js"

/*
 * Both lists are real text from a kandy board's transcript table, not invented
 * examples. One error frame in ten was an auth failure; the rest are what a
 * loose matcher would wrongly catch.
 */

test("an agent saying it cannot authenticate is recognised", () => {
  const yes = [
    "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.",
    "OAuth session expired and could not be refreshed",
    "401 Unauthorized",
    '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    "You are not logged in. Run `claude login` to sign in.",
  ]
  for (const t of yes) assert.equal(isAuthFailure(t), true, t.slice(0, 48))
})

test("every other kind of failure is left alone", () => {
  // A wrong yes sends someone to fix a sign-in that works, which is the same
  // false alarm as trusting a stale credential file.
  const no = [
    "Command failed: git worktree add -b kandy/note_x /Users/me/repo/.kandy/worktrees/x",
    "Model metadata for `gpt-5.6` not found. Defaulting to fallback metadata; this can degrade performance.",
    '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6\' model is not supported"}}',
    "`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.",
    "Skill descriptions were shortened to fit the skills context budget.",
    "run failed",
    "Error: ENOENT: no such file or directory, open 'token'",
    "rate limit exceeded, please try again later",
  ]
  for (const t of no) assert.equal(isAuthFailure(t), false, t.slice(0, 48))
})

test("nothing at all is not a failure", () => {
  assert.equal(isAuthFailure(null), false)
  assert.equal(isAuthFailure(undefined), false)
  assert.equal(isAuthFailure(""), false)
})
