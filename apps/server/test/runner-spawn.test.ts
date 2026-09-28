import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Before anything that reads the state dir is loaded: this must never touch
// the real one.
const home = mkdtempSync(path.join(tmpdir(), "kandy-spawn-"))
process.env["XDG_STATE_HOME"] = path.join(home, "state")
process.env["XDG_DATA_HOME"] = path.join(home, "data")
process.env["XDG_CONFIG_HOME"] = path.join(home, "config")

const { Engine } = await import("../dist/engine.js")
const { Store } = await import("../dist/store.js")
const { LocalLog } = await import("../dist/local-log.js")
const { Runner } = await import("../dist/runner.js")
const { ADAPTERS } = await import("../dist/agents/index.js")
const { resolveCommand, shimTarget } = await import("../dist/agents/command.js")

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-spawn-repo-"))
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" })
  git("init", "-q")
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "first")
  return dir
}

/*
 * An agent whose binary is not on this machine.
 *
 * spawn reports that as an 'error' event on the next tick. With no listener
 * yet — the runner used to attach one only after an await — Node throws it,
 * and the daemon died with every other note's agent in it.
 */
test("an agent that isn't installed fails its note and leaves the daemon up", async () => {
  const real = ADAPTERS.aider!
  ADAPTERS.aider = {
    ...real,
    bin: "kandy-no-such-agent",
    spawn: () => ({ command: "kandy-no-such-agent-binary", args: [] }),
  }
  try {
    const engine = new Engine(new Store(path.join(home, "spawn.db")))
    const emit = (type: string, data: unknown) => engine.emit({ type, data } as never)
    emit("board.created", { boardId: "b1", name: "demo", repoPath: repo() })
    emit("column.created", { columnId: "c1", boardId: "b1", name: "Inbox", pos: "a", lane: "inbox" })
    emit("note.created", { noteId: "n1", boardId: "b1", columnId: "c1", title: "T", body: "", pos: "a" })

    const runner = new Runner(new LocalLog(engine), 1)
    const runId = runner.request("b1", "n1", "aider")

    let run
    for (let i = 0; i < 100; i++) {
      run = engine.view("b1")!.runs.find((r) => r.id === runId)
      if (run?.status === "failed") break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(run?.status, "failed")
    assert.match(run!.error ?? "", /aider isn't installed on this machine/)
    assert.equal(engine.view("b1")!.notes[0]!.status, "failed")
    engine.close()
  } finally {
    ADAPTERS.aider = real
  }
})

test("off Windows, a command is run as named", () => {
  assert.deepEqual(resolveCommand("codex", ["exec", "hi"], { platform: "darwin" }), {
    command: "codex",
    args: ["exec", "hi"],
  })
})

/*
 * On Windows an npm-installed agent is a .cmd shim, which spawn without a
 * shell never finds. The script it points at is run with Node instead, so a
 * prompt with newlines in it survives — cmd.exe would cut it at the first.
 */
test("on Windows, an npm shim is found on PATH and its script run with node", () => {
  const bin = mkdtempSync(path.join(tmpdir(), "kandy-shim-"))
  const shim = path.join(bin, "codex.cmd")
  writeFileSync(
    shim,
    [
      "@ECHO off",
      "SETLOCAL",
      "CALL :find_dp0",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ].join("\r\n"),
  )
  const script = path.join(bin, "node_modules", "@openai", "codex", "bin", "codex.js")
  assert.equal(shimTarget(shim), script)

  const c = resolveCommand("codex", ["exec", "two\nlines"], {
    platform: "win32",
    env: { PATH: bin, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
  })
  assert.equal(c.command, process.execPath)
  assert.deepEqual(c.args, [script, "exec", "two\nlines"])
})

test("on Windows, a shim that isn't npm's goes through cmd.exe, quoted", () => {
  const bin = mkdtempSync(path.join(tmpdir(), "kandy-shim-"))
  writeFileSync(path.join(bin, "agent.cmd"), "@echo off\r\nsomething-else.exe %*\r\n")
  const c = resolveCommand("agent", ["a & b"], { platform: "win32", env: { PATH: bin, PATHEXT: ".EXE;.CMD", ComSpec: "cmd.exe" } })
  assert.equal(c.command, "cmd.exe")
  assert.equal(c.windowsVerbatimArguments, true)
  assert.deepEqual(c.args.slice(0, 3), ["/d", "/s", "/c"])
  // The & is escaped for cmd, so it cannot start a second command.
  assert.match(c.args[3]!, /\^&/)
  assert.doesNotMatch(c.args[3]!, /[^^]&/)
})

test("on Windows, an agent that isn't on PATH is left for spawn to report", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "kandy-shim-"))
  mkdirSync(path.join(empty, "sub"))
  assert.deepEqual(resolveCommand("aider", ["--version"], { platform: "win32", env: { PATH: empty, PATHEXT: ".EXE;.CMD" } }), {
    command: "aider",
    args: ["--version"],
  })
})
