import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { LocalLog } from "../dist/local-log.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dist = (f: string) => readFileSync(path.join(HERE, "..", "dist", f), "utf8")

/*
 * The seam.
 *
 * `Log` exists so the runner works whether its log is in this process or on a
 * hub across a network. The tests that matter for it are therefore structural:
 * that the runner cannot reach past the interface, and that the local
 * implementation really is the calls it replaced rather than a second
 * behaviour that will drift.
 */

/** An Engine double that records rather than does. */
function spy() {
  const calls: [string, unknown[]][] = []
  const note = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return undefined as never
  }
  const engine = {
    emit: note("emit"),
    say: note("say"),
    activity: note("activity"),
    view: (id: string) => {
      calls.push(["view", [id]])
      return null
    },
    store: {
      appendOutput: note("store.appendOutput"),
      saveDiff: note("store.saveDiff"),
      transcriptSince: (...args: unknown[]) => {
        calls.push(["store.transcriptSince", args])
        return []
      },
    },
  }
  return { engine, calls }
}

test("the runner reaches the log through the interface and nothing else", () => {
  // If this fails, someone has reintroduced a direct dependency and the
  // remote runner will be a second implementation rather than a second
  // transport. That is precisely the drift `Log` was extracted to prevent.
  const runner = dist("runner.js")
  assert.equal(
    /from\s+["'].*engine\.js["']/.test(runner),
    false,
    "runner.js must not import engine.js",
  )
  assert.equal(
    /\.engine\b/.test(runner),
    false,
    "runner.js must not reference an engine at all",
  )
})

test("every write forwards to the call it replaced", () => {
  const { engine, calls } = spy()
  const log = new LocalLog(engine as never)

  log.emit({ type: "board.removed", data: { boardId: "board_1" } } as never)
  log.say("run_1", "assistant", "hello", "meta")
  log.activity("run_1", "bash", "npm test")
  log.output("run_1", "stderr", "boom")
  log.saveDiff("note_1", { runId: "run_1", branch: "b", stat: "s", diff: "d" })
  log.view("board_1")

  assert.deepEqual(
    calls.map(([name]) => name),
    ["emit", "say", "activity", "store.appendOutput", "store.saveDiff", "view"],
  )
  assert.deepEqual(calls[1]![1], ["run_1", "assistant", "hello", "meta"])
  assert.deepEqual(calls[3]![1], ["run_1", "stderr", "boom"])
})

test("the actor is fixed per log, not chosen per call", () => {
  // A single-player daemon has one person and nobody to distinguish them
  // from; a hub reads the actor off each connection instead. Either way the
  // runner never supplies it, so a compromised or buggy runner cannot claim
  // to be someone else.
  const { engine, calls } = spy()
  new LocalLog(engine as never, "alice@example.com").emit({
    type: "board.removed",
    data: { boardId: "board_1" },
  } as never)

  assert.equal(calls[0]![1][1], "alice@example.com")
})

test("with no actor given, nobody is recorded", () => {
  const { engine, calls } = spy()
  new LocalLog(engine as never).emit({
    type: "board.removed",
    data: { boardId: "board_1" },
  } as never)

  assert.equal(calls[0]![1][1], null)
})

test("history is promised even when it is already in hand", async () => {
  const { engine, calls } = spy()
  const frames = new LocalLog(engine as never).history("run_1")

  assert.ok(frames instanceof Promise, "a remote log cannot answer synchronously")
  assert.deepEqual(await frames, [])
  assert.deepEqual(calls[0], ["store.transcriptSince", ["run_1", 0, 5000]])
})
