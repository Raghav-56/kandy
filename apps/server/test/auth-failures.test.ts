import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/*
 * Both redirects have to happen before anything imports the modules that read
 * them: `paths.js` resolves STATE_DIR at import, and every adapter bakes its
 * credential path from `homedir()` — which on POSIX is `$HOME`. Without the
 * second one this test would write over the real `~/.codex/auth.json` and log
 * you out of Codex to prove a point about being logged out of Codex.
 *
 * node:test gives each file its own process, so neither leaks.
 */
const home = mkdtempSync(path.join(tmpdir(), "kandy-authfail-"))
process.env["HOME"] = home
process.env["XDG_STATE_HOME"] = path.join(home, "state")

const { authFailures, clearAuthFailure, recordAuthFailure } = await import("../dist/auth-failures.js")
const { codex } = await import("../dist/agents/codex.js")
const { aider } = await import("../dist/agents/aider.js")

const credential = codex.credentials[0]!
const record = path.join(home, "state", "kandy", "auth-failures.json")

test("the fake home took, so nothing below touches the real one", () => {
  assert.equal(credential, path.join(home, ".codex", "auth.json"))
})

mkdirSync(path.dirname(credential), { recursive: true })

function credentialWrittenAt(when: number): void {
  writeFileSync(credential, "{}")
  utimesSync(credential, when / 1000, when / 1000)
}

const stored = () => JSON.parse(readFileSync(record, "utf8")) as Record<string, number>

test("a refused run outlives the daemon that saw it", () => {
  const at = Date.now()
  credentialWrittenAt(at - 60_000)
  recordAuthFailure("codex", at)

  // On disk is the whole point: a restart re-reads this rather than the Map
  // that used to hold it, which is what put a revoked token back to "ready".
  assert.equal(stored()["codex"], at)
  assert.deepEqual(authFailures(), [{ agent: "codex", at }])
  clearAuthFailure("codex")
})

test("signing back in retires the warning, because it rewrites the credential", () => {
  const at = Date.now() - 60_000
  credentialWrittenAt(at - 60_000)
  recordAuthFailure("codex", at)
  assert.equal(authFailures().length, 1)

  // What `codex login` does, as far as we can observe it.
  credentialWrittenAt(Date.now())

  assert.deepEqual(authFailures(), [])
  // Retired, not merely filtered — it must not be reconsidered every poll.
  assert.deepEqual(stored(), {})
})

test("a completed run clears it outright", () => {
  credentialWrittenAt(Date.now() - 60_000)
  recordAuthFailure("codex", Date.now())
  clearAuthFailure("codex")
  assert.deepEqual(authFailures(), [])
})

test("an agent that keeps no credential file we know of stays reported", () => {
  // aider authenticates by environment variable, so there is no mtime that
  // could ever retire the failure. Forgetting it on a timer instead would be
  // inventing an expiry we have no evidence for.
  assert.deepEqual(aider.credentials, [])

  const at = Date.now()
  recordAuthFailure("aider", at)
  assert.deepEqual(authFailures(), [{ agent: "aider", at }])
  clearAuthFailure("aider")
})
