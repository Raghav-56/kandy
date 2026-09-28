import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { badValue, closest, extraWords, isFlag, unknownAgent, unknownCommand } from "../dist/cli/argv.js"
import { failureOf } from "../dist/tui/board.js"

// commands.js reaches the state dir as it loads; keep it off the real one.
const scratch = mkdtempSync(path.join(tmpdir(), "kandy-words-home-"))
process.env["XDG_STATE_HOME"] = scratch
process.env["XDG_CONFIG_HOME"] = scratch
process.env["XDG_DATA_HOME"] = scratch
const { pickNote } = await import("../dist/cli/commands.js")

/*
 * `kandy "fix the flash"` writes a note and starts an agent, so every word
 * the CLI misreads as a note is a paid run nobody asked for. These are the
 * command lines that used to do exactly that.
 */

const CLI = path.join(fileURLToPath(new URL("../dist/cli.js", import.meta.url)))

/** The CLI on a throwaway state dir, on a port nothing listens on. */
function kandy(args: string[]): Promise<{ out: string; err: string; code: number | null; state: string }> {
  const state = mkdtempSync(path.join(tmpdir(), "kandy-words-"))
  return new Promise((resolve) => {
    const c = spawn("node", [CLI, ...args], {
      env: {
        ...process.env,
        XDG_STATE_HOME: state,
        XDG_CONFIG_HOME: state,
        XDG_DATA_HOME: state,
        KANDY_LOCAL: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    c.stdout.on("data", (d: Buffer) => (out += d.toString()))
    c.stderr.on("data", (d: Buffer) => (err += d.toString()))
    c.on("close", (code) => resolve({ out, err, code, state }))
  })
}

test("a single unknown word is refused with a guess, not run as a note", async () => {
  for (const [word, guess] of [
    ["stauts", /did you mean kandy status/],
    ["upadte", /did you mean kandy update/],
    ["start", /starts by itself/],
    ["restart", /kandy stop/],
    ["version", /kandy --version/],
    ["doctor", /kandy status/],
  ] as const) {
    const r = await kandy([word, "--port", "45790"])
    assert.equal(r.code, 1, word)
    assert.match(r.err, new RegExp(`unknown command '${word}'`))
    assert.match(r.err, guess)
    assert.match(r.err, new RegExp(`kandy new ${word}`))
    assert.doesNotMatch(r.err, /starting kandy/, "no daemon was started for it")
  }
})

test("a command that takes no words refuses them instead of dropping them", async () => {
  const r = await kandy(["status", "bar", "looks", "wrong", "--port", "45790"])
  assert.equal(r.code, 1)
  assert.match(r.err, /status takes no arguments — to write a note, quote it: kandy "status bar looks wrong"/)

  const stop = await kandy(["stop", "the", "flicker", "--port", "45790"])
  assert.equal(stop.code, 1)
  assert.match(stop.err, /stop takes no arguments/)
})

test("--agent is checked before anything is made", async () => {
  const typo = await kandy(["fix the flash", "--agent", "claud", "--port", "45790"])
  assert.equal(typo.code, 1)
  assert.match(typo.err, /no agent called 'claud' — did you mean --agent claude\?/)

  const eaten = await kandy(["fix the flash", "--agent", "--port", "45790"])
  assert.equal(eaten.code, 1)
  assert.match(eaten.err, /--agent needs a value — got --port/)
})

test("kandy setup with no terminal says which defaults it used and opens nothing", async () => {
  const r = await kandy(["setup", "--port", "45790"])
  assert.equal(r.code, 0)
  assert.match(r.out, /no terminal to ask in — used the defaults: solo, full access/)
  assert.doesNotMatch(r.out + r.err, /How will you use it|interactive terminal/)
  const saved = path.join(r.state, "kandy", "setup.json")
  assert.ok(existsSync(saved))
  assert.equal(JSON.parse(readFileSync(saved, "utf8")).mode, "solo")
})

test("words are parsed the way a person means them", () => {
  // A quoted sentence starting with a dash is a note; a bare -x is a flag.
  assert.equal(isFlag("-x"), true)
  assert.equal(isFlag("-x flag crashes"), false)
  assert.equal(isFlag("-"), false)

  assert.equal(badValue(["--agent", "codex"], ["--agent"]), null)
  assert.equal(badValue(["--agent"], ["--agent"]), "--agent needs a value")
  assert.equal(unknownAgent("codex", ["claude", "codex"]), null)
  assert.match(unknownAgent("gemini", ["claude", "codex"])!, /kandy can run claude, codex/)
  assert.match(unknownAgent("cursor-agent", ["claude", "cursor"])!, /--agent cursor/)

  // A sentence is a note, however it starts.
  assert.equal(unknownCommand(["fix the login flash"]), null)
  assert.equal(unknownCommand(["fix", "the", "flash"]), null)
  assert.notEqual(unknownCommand(["refactor"]), null)

  assert.equal(extraWords("status", []), null)
  assert.equal(extraWords("new", ["a", "b"]), null)
  assert.equal(closest("lg", ["log", "gc"]), "log")
  assert.equal(closest("xyzzy", ["log", "gc"]), null)
})

test("kandy run picks the newest draft, or the one note that matches", () => {
  const note = (id: string, title: string, status: string, createdAt: number) =>
    ({ id, title, status, createdAt }) as never
  const notes = [
    note("note_a", "fix the login flash", "draft", 1),
    note("note_b", "tidy the footer", "draft", 3),
    note("note_c", "fix the footer", "failed", 2),
    note("note_d", "fix the header", "done", 4),
  ]
  assert.equal((pickNote(notes, "") as { note: { id: string } }).note.id, "note_b")
  assert.equal((pickNote(notes, "login") as { note: { id: string } }).note.id, "note_a")
  assert.equal((pickNote(notes, "note_c") as { note: { id: string } }).note.id, "note_c")
  assert.equal(pickNote(notes, "footer").kind, "many")
  assert.equal(pickNote(notes, "header").kind, "none", "finished work is not what run means")
  assert.equal(pickNote([], "").kind, "none")
})

test("a failed note says whether it failed, was cancelled, or was interrupted", () => {
  assert.equal(failureOf({ status: "failed", error: "daemon restarted while this run was in flight" }).kind, "interrupted")
  assert.equal(failureOf({ status: "cancelled", error: null }).kind, "cancelled")
  const f = failureOf({ status: "failed", error: "\nboom\nstack" })
  assert.equal(f.kind, "failed")
  assert.equal(f.reason, "boom")
})

test("status --json is JSON, with no banner", async () => {
  const state = mkdtempSync(path.join(tmpdir(), "kandy-status-"))
  const env = { ...process.env, XDG_STATE_HOME: state, XDG_CONFIG_HOME: state, XDG_DATA_HOME: state, KANDY_LOCAL: "1", NO_COLOR: "1" }
  const daemon = spawn("node", [CLI, "serve", "--port", "45791"], { env, stdio: "ignore" })
  try {
    const up = async () => fetch("http://127.0.0.1:45791/health").then((r) => r.ok, () => false)
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250))
    assert.equal(await up(), true, "daemon never came up")

    const out = await new Promise<string>((resolve) => {
      const c = spawn("node", [CLI, "status", "--json", "--port", "45791"], { env })
      let buf = ""
      c.stdout.on("data", (d: Buffer) => (buf += d.toString()))
      c.on("close", () => resolve(buf))
    })
    const s = JSON.parse(out) as {
      daemon: { up: boolean; port: number; pid: number; version: string }
      repos: unknown[]
      agents: { id: string; state: string }[]
      hub: unknown
    }
    assert.equal(s.daemon.up, true)
    assert.equal(s.daemon.port, 45791)
    assert.equal(typeof s.daemon.pid, "number")
    assert.equal(typeof s.daemon.version, "string")
    assert.ok(Array.isArray(s.repos))
    assert.ok(s.agents.some((a) => a.id === "claude"))
    assert.equal(s.hub, null)
  } finally {
    daemon.kill()
  }
})
