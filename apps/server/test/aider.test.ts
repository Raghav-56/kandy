import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { aider } from "../dist/agents/aider.js"
import { adapter, detect } from "../dist/agents/index.js"
import { defaultModelFor } from "../dist/pricing.js"

const opts = { cwd: "/wt", prompt: "fix this\nwithout shell expansion $(echo nope)", policy: "repo" as const }

test("registered aider delegates credentials and model defaults to the child", () => {
  assert.equal(adapter("aider"), aider)
  assert.deepEqual(aider.credentials, [])
  assert.equal(defaultModelFor("aider"), null)
  const spec = aider.spawn(opts)
  assert.equal(spec.command, "aider")
  assert.equal(spec.args[spec.args.indexOf("--message") + 1], opts.prompt)
  assert.equal(spec.env, undefined)
  assert.equal(aider.live, undefined)
  for (const flag of ["--no-stream", "--no-pretty", "--yes-always", "--no-auto-commits", "--no-dirty-commits", "--no-suggest-shell-commands", "--no-auto-lint", "--no-auto-test"]) {
    assert.ok(spec.args.includes(flag), flag)
  }
  const full = aider.spawn({ ...opts, policy: "full", model: "openai/test" })
  assert.ok(!full.args.includes("--no-suggest-shell-commands"))
  assert.equal(full.args[full.args.indexOf("--model") + 1], "openai/test")
})

test("text, edits, errors and ANSI output become transcript events", () => {
  assert.deepEqual(aider.parse("  "), [])
  assert.deepEqual(aider.parse("\x1b[32mWorking\x1b[0m\r"), [{ kind: "text", text: "Working" }])
  assert.deepEqual(aider.parse("Applied edit to src/a file.ts"), [{ kind: "tool", tool: "edit", detail: "src/a file.ts", status: "completed" }])
  assert.deepEqual(aider.parse("Error: missing model"), [{ kind: "error", message: "Error: missing model" }])
  assert.deepEqual(aider.parse("Tokens: unknown"), [{ kind: "text", text: "Tokens: unknown" }])
})

test("message usage is additive; cumulative session dollars are ignored", () => {
  const text = "Tokens: 1.2k sent, 345 received. Cost: $0.0031 message, $0.52 session."
  assert.deepEqual(aider.parse(text), [{ kind: "usage", text, tokens: 1545, costUsd: 0.0031, turns: 1 }])
  const zero = aider.parse("Tokens: 0 sent, 0 received. Cost: $0.00 message, $0.00 session.")[0]!
  assert.equal(zero.kind === "usage" && zero.costUsd, 0)
})

test("cache summaries and cost on a separate line do not duplicate tokens or turns", () => {
  const text = "Tokens: 1.5M sent, 500 cache write, 2k cache hit, 1,234 received."
  assert.deepEqual(aider.parse(text), [{ kind: "usage", text, tokens: 1501234, costUsd: null, turns: 1 }])
  const cost = "Cost: $0.02 message, $0.50 session."
  assert.deepEqual(aider.parse(cost), [{ kind: "usage", text: cost, tokens: null, costUsd: 0.02, turns: null }])
  // Cached buckets are informational, not added again to aider's sent total.
  assert.ok(!aider.parse(text).some((e) => e.kind === "turn_end"))
})

test("detect and spawn work with a CLI executable and inherited environment", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kandy-aider-"))
  try {
    const bin = path.join(dir, "aider")
    await writeFile(bin, `#!${process.execPath}\nif (process.argv.includes('--version')) console.log('aider fixture');\nelse { console.log(process.env.KANDY_ADAPTER_TEST); console.log('Applied edit to example.ts'); }\n`, { mode: 0o755 })
    const detected = await detect({ ...aider, bin })
    // aider declares no credential file and no readAuth: it validates its own
    // provider setup, so kandy has nothing to say about expiry or plan.
    assert.deepEqual(detected, {
      id: "aider",
      installed: true,
      authed: true,
      version: "aider fixture",
      expiresAt: null,
      plan: null,
      authFailedAt: null,
    })
    const spec = aider.spawn(opts)
    const child = spawn(bin, spec.args, { cwd: dir, env: { ...process.env, KANDY_ADAPTER_TEST: "inherited" }, stdio: ["pipe", "pipe", "pipe"] })
    child.stdin.end()
    let stdout = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    const code = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject) })
    assert.equal(code, 0)
    assert.deepEqual(stdout.trim().split("\n").flatMap(aider.parse), [
      { kind: "text", text: "inherited" },
      { kind: "tool", tool: "edit", detail: "example.ts", status: "completed" },
    ])
    assert.equal((await detect({ ...aider, bin: path.join(dir, "missing") })).authed, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a stale credential file never outvotes the live one", async () => {
  /*
   * The bug this exists for, and it shipped.
   *
   * On macOS Claude Code keeps the live credential in the Keychain and leaves
   * ~/.claude/.credentials.json behind from before it moved. Reading the file
   * reported a sign-in that had expired a month earlier while the real one was
   * good for another fortnight — so kandy told a signed-in person to sign in
   * again, which is worse than the missing detection it replaced.
   *
   * detect() is the seam: whichever source readAuth consults, a live answer
   * has to win and an unreadable one has to be null rather than expired.
   */
  const dir = await mkdtemp(path.join(tmpdir(), "kandy-stale-"))
  try {
    const bin = path.join(dir, "fake")
    await writeFile(bin, `#!${process.execPath}\nconsole.log('fake 1.0')\n`, { mode: 0o755 })
    const cred = path.join(dir, "creds.json")
    await writeFile(cred, "{}")

    const stale = Date.now() - 30 * 86_400_000
    const live = Date.now() + 14 * 86_400_000
    const base = { ...aider, bin, credentials: [cred] }

    // The live source answers; the stale file is never reached.
    const preferred = await detect({ ...base, readAuth: () => ({ expiresAt: live, plan: "max" }) })
    assert.equal(preferred.authed, true, "a live credential is signed in")
    assert.equal(preferred.expiresAt, live)

    // Only when nothing live is available does the older answer stand.
    const fallback = await detect({ ...base, readAuth: () => ({ expiresAt: stale, plan: "max" }) })
    assert.equal(fallback.authed, false)

    // Unreadable is unknown, not expired: the file may simply not be the source.
    const unknown = await detect({ ...base, readAuth: () => null })
    assert.equal(unknown.expiresAt, null)
    assert.equal(unknown.authed, true, "unknown expiry must not read as expired")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("an expired credential is not signed in", async () => {
  // The bug this exists for: a credential file outlives the credential in it,
  // so checking that the file is there reported a month-dead sign-in as ready
  // and the first sign of trouble was a run failing.
  const dir = await mkdtemp(path.join(tmpdir(), "kandy-auth-"))
  try {
    const bin = path.join(dir, "fake")
    await writeFile(bin, `#!${process.execPath}\nconsole.log('fake 1.0')\n`, { mode: 0o755 })
    const cred = path.join(dir, "creds.json")
    await writeFile(cred, "{}")

    const base = { ...aider, bin, credentials: [cred] }
    const dead = await detect({ ...base, readAuth: () => ({ expiresAt: Date.now() - 1000, plan: "max" }) })
    assert.equal(dead.authed, false, "an expired sign-in is not usable")
    assert.equal(dead.plan, "max", "the plan is still worth reporting")

    const live = await detect({ ...base, readAuth: () => ({ expiresAt: Date.now() + 86_400_000, plan: "max" }) })
    assert.equal(live.authed, true)

    // No expiry recorded means "it did not say", never "it is fine" — but with
    // the file present there is nothing to contradict, so it stays usable.
    const silent = await detect({ ...base, readAuth: () => ({ expiresAt: null, plan: "chatgpt" }) })
    assert.equal(silent.authed, true)
    assert.equal(silent.expiresAt, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
