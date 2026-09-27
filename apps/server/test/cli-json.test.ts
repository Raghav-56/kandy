import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * `--json` is a promise to a script, and a script cannot read a help page.
 *
 * These exist because `kandy serve --json` was documented in the CLI's own
 * help for weeks while the flag was rejected as unknown — a claim nobody had
 * run. Anything machine-readable needs a test that is itself a machine.
 */
const CLI = path.join(fileURLToPath(new URL("../dist/cli.js", import.meta.url)))

/** Run the daemon on a throwaway state dir, capture its first line, kill it. */
function serveOnce(args: string[]): Promise<{ line: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI, "serve", ...args], {
      env: { ...process.env, XDG_STATE_HOME: mkdtempSync(path.join(tmpdir(), "kandy-cli-")) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let buf = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`no output in 10s; got: ${JSON.stringify(buf)}`))
    }, 10_000)

    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString()
      const nl = buf.indexOf("\n")
      if (nl === -1) return
      clearTimeout(timer)
      const line = buf.slice(0, nl)
      child.kill()
      child.on("close", (code) => resolve({ line, code }))
    })
    child.on("error", reject)
  })
}

test("serve --json emits one line of JSON a supervisor can read", async () => {
  // Port 0 would be ideal, but the daemon binds a fixed port by design; pick a
  // high one unlikely to collide with a real daemon.
  const { line } = await serveOnce(["--json", "--port", "45771"])

  const info = JSON.parse(line) as Record<string, unknown>
  assert.equal(info.url, "http://127.0.0.1:45771")
  assert.equal(info.port, 45771)
  assert.equal(typeof info.slots, "number")
  assert.equal(typeof info.db, "string")
  assert.equal(typeof info.pid, "number")
  assert.equal(typeof info.webBuilt, "boolean")
})

test("serve --json never prints the daemon token", async () => {
  // It names the file instead. stdout is captured by supervisors and CI logs,
  // and a credential that reaches a log is a credential that has leaked.
  const { line } = await serveOnce(["--json", "--port", "45772"])

  const info = JSON.parse(line) as { tokenPath?: string }
  assert.equal(typeof info.tokenPath, "string")
  assert.ok(!/[a-f0-9]{64}/.test(line), "a 64-char hex token must not appear in the output")
})

test("the banner is suppressed under --json", async () => {
  const { line } = await serveOnce(["--json", "--port", "45773"])
  assert.ok(!line.includes("▛"), "no box-drawing banner on a machine-readable stream")
  assert.doesNotThrow(() => JSON.parse(line))
})

test("kandy stop stops the daemon on its port, and says so when there is none", async () => {
  // Restarting kandy used to mean finding its pid by hand.
  const state = mkdtempSync(path.join(tmpdir(), "kandy-stop-"))
  const env = { ...process.env, XDG_STATE_HOME: state, XDG_CONFIG_HOME: state, KANDY_LOCAL: "1", NO_COLOR: "1" }
  const daemon = spawn("node", [CLI, "serve", "--port", "45773"], { env, stdio: "ignore" })
  const up = async () => fetch("http://127.0.0.1:45773/health").then((r) => r.ok, () => false)
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250))
  assert.equal(await up(), true, "daemon never came up")

  const run = (): Promise<{ out: string; code: number | null }> =>
    new Promise((resolve) => {
      const c = spawn("node", [CLI, "stop", "--port", "45773"], { env })
      let out = ""
      c.stdout.on("data", (d: Buffer) => (out += d.toString()))
      c.on("close", (code) => resolve({ out, code }))
    })

  const first = await run()
  assert.equal(first.code, 0)
  assert.match(first.out, /stopped/)
  assert.equal(await up(), false)

  const again = await run()
  assert.equal(again.code, 0)
  assert.match(again.out, /isn't running/)
  daemon.kill()
})
