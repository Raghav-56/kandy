import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Engine } from "../dist/engine.js"
import { Store } from "../dist/store.js"
import { Permissions } from "../dist/permission.js"

const BOARD = "b1"
const NOTE = "n1"
const RUN = "r1"

/**
 * A daemon's worth of state on a throwaway file, with one board, one note and
 * one run in flight — the situation in which an agent can ask anything at all.
 */
function fresh(timeoutMs = 50) {
  const dir = mkdtempSync(path.join(tmpdir(), "kandy-ask-"))
  const engine = new Engine(new Store(path.join(dir, "test.db")))
  const emit = (type: string, data: unknown) => engine.emit({ type, data } as never)

  emit("board.created", { boardId: BOARD, name: "demo", repoPath: "/tmp/demo" })
  emit("column.created", { columnId: "c1", boardId: BOARD, name: "Inbox", pos: "a", lane: "inbox" })
  emit("note.created", {
    noteId: NOTE,
    boardId: BOARD,
    columnId: "c1",
    title: "T",
    body: "",
    pos: "a",
  })
  emit("run.requested", { runId: RUN, noteId: NOTE, agent: "claude" })

  const permissions = new Permissions(
    engine,
    (runId: string) => (runId === RUN ? { boardId: BOARD, noteId: NOTE } : null),
    timeoutMs,
  )
  return { engine, permissions, emit, view: () => engine.view(BOARD)! }
}

/** Let the pending request reach the board before asserting about it. */
const settle = () => new Promise((r) => setImmediate(r))

/**
 * Hold the event loop open while waiting on a question to expire.
 *
 * The timeout inside Permissions is deliberately `unref`'d — a question nobody
 * has answered must not keep the daemon alive. In a test where that timer is
 * the only pending work, the loop empties, node decides the awaited promise
 * has been abandoned, and reports "Promise resolution is still pending but the
 * event loop has already resolved" — cancelling the rest of the file with it.
 *
 * Passed locally and failed on CI's first run, because this machine had enough
 * incidental handles open to mask it. The fix belongs here rather than in
 * `permission.ts`: the daemon's behaviour is the correct one.
 */
async function awaitingTimeout<T>(work: Promise<T>): Promise<T> {
  const keepAlive = setInterval(() => {}, 1_000)
  try {
    return await work
  } finally {
    clearInterval(keepAlive)
  }
}

test("an unanswered request blocks, and the question lands on the board", async () => {
  const { permissions, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()

  const [prompt, ...rest] = view().prompts
  assert.equal(rest.length, 0)
  assert.ok(prompt)
  assert.equal(prompt.tool, "Bash")
  // Verbatim. The user approves exactly the string they were shown.
  assert.equal(prompt.command, "pnpm test")
  assert.equal(prompt.noteId, NOTE)
  assert.equal(prompt.runId, RUN)
  assert.deepEqual(prompt.rule, { tool: "Bash", pattern: "pnpm test*", decision: "allow" })

  // The note reads blocked while the agent is standing still.
  assert.equal(view().notes[0]!.status, "blocked")

  // And nothing has been handed back to the agent yet.
  let resolved = false
  void pending.then(() => (resolved = true))
  await settle()
  assert.equal(resolved, false)

  permissions.answer(prompt.requestId, { decision: "deny" })
  await pending
})

test("allow resolves the deferred and clears the question", async () => {
  const { permissions, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()

  const prompt = view().prompts[0]!
  assert.equal(permissions.answer(prompt.requestId, { decision: "allow", scope: "once" }), true)

  const verdict = await pending
  assert.deepEqual(verdict, { behavior: "allow", updatedInput: { command: "pnpm test" } })
  assert.deepEqual(view().prompts, [])
  assert.equal(view().notes[0]!.status, "running")
  // "once" means once: nothing standing was written.
  assert.deepEqual(view().notes[0]!.rules, [])
})

test("allow with note scope writes a rule, and the next request never asks", async () => {
  const { permissions, view } = fresh(10_000)
  const first = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()
  permissions.answer(view().prompts[0]!.requestId, { decision: "allow", scope: "note" })
  await first

  assert.deepEqual(view().notes[0]!.rules, [
    { tool: "Bash", pattern: "pnpm test*", decision: "allow" },
  ])

  // The second call is decided by the rule, so it resolves without ever
  // reaching the board.
  const second = await permissions.request(RUN, "Bash", { command: "pnpm test -u" })
  assert.deepEqual(second, { behavior: "allow", updatedInput: { command: "pnpm test -u" } })
  assert.deepEqual(view().prompts, [])
})

test("the rule is written for this note and no wider", async () => {
  const { permissions, view, emit } = fresh(10_000)
  emit("note.created", {
    noteId: "n2",
    boardId: BOARD,
    columnId: "c1",
    title: "other",
    body: "",
    pos: "b",
  })
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()
  permissions.answer(view().prompts[0]!.requestId, { decision: "allow", scope: "note" })
  await pending

  const other = view().notes.find((n) => n.id === "n2")!
  assert.deepEqual(other.rules, [])
  assert.equal(view().board.defaultPolicy, "repo")
})

test("deny carries the user's message back to the agent", async () => {
  const { permissions, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "npm test" })
  await settle()

  permissions.answer(view().prompts[0]!.requestId, {
    decision: "deny",
    comment: "run the tests with pnpm, not npm",
  })

  const verdict = await pending
  assert.equal(verdict.behavior, "deny")
  // The message is the whole point of the third option: "deny" alone is not an
  // answer, and an agent given only that reasons its way around the refusal.
  assert.match(verdict.message, /run the tests with pnpm, not npm/)
  assert.deepEqual(view().prompts, [])
})

test("deny without a message still tells the agent not to retry", async () => {
  const { permissions, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "rm -rf /" })
  await settle()
  permissions.answer(view().prompts[0]!.requestId, { decision: "deny" })

  const verdict = await pending
  assert.equal(verdict.behavior, "deny")
  assert.match(verdict.message, /denied/i)
})

test("a question nobody answers times out rather than hanging forever", async () => {
  const { permissions, engine, view } = fresh(30)
  const started = Date.now()
  const verdict = await awaitingTimeout(permissions.request(RUN, "Bash", { command: "pnpm test" }))

  assert.ok(Date.now() - started >= 25)
  assert.equal(verdict.behavior, "deny")
  assert.match(verdict.message, /Nobody answered/)
  assert.deepEqual(view().prompts, [])

  // And the transcript says so, because an agent that was denied because
  // nobody was looking is a different story from one a person refused.
  const said = engine.store.transcriptSince(RUN, 0).map((f) => f.text)
  assert.ok(said.some((t) => /no answer after/i.test(t)), said.join(" | "))

  // Recorded as a timeout in the log, not as a decision someone made.
  const unblocked = engine.store
    .since(0)
    .filter((e) => e.type === "run.unblocked")
    .map((e) => (e.data as { decision: string }).decision)
  assert.deepEqual(unblocked, ["timeout"])
})

test("answering a question that already timed out is a no-op, not a crash", async () => {
  const { permissions, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()
  const { requestId } = view().prompts[0]!

  assert.equal(permissions.answer(requestId, { decision: "allow" }), true)
  await pending
  // Two browser tabs on one board is the normal case; the second one to press
  // a button has done nothing wrong.
  assert.equal(permissions.answer(requestId, { decision: "deny" }), false)
})

test("a run that ends settles what it was waiting on", async () => {
  const { permissions, engine, view } = fresh(10_000)
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" })
  await settle()
  assert.equal(view().prompts.length, 1)

  permissions.abandon(RUN)
  const verdict = await pending
  assert.equal(verdict.behavior, "deny")

  // `abandon` writes no decision — nobody made one. The run.finished the
  // runner emits next is what takes the question off the board.
  engine.emit({
    type: "run.finished",
    data: { runId: RUN, noteId: NOTE, status: "cancelled", exitCode: null, error: null },
  } as never)
  assert.deepEqual(view().prompts, [])
})

test("an agent that stops listening takes its question off the board", async () => {
  const { permissions, engine, view } = fresh(10_000)
  const gone = new AbortController()
  const pending = permissions.request(RUN, "Bash", { command: "pnpm test" }, gone.signal)
  await settle()

  const { requestId } = view().prompts[0]!
  assert.equal(permissions.pending(requestId), true)

  // The sidecar's connection dropped. Nobody can answer this any more, and a
  // card left up would invite someone to try.
  gone.abort()
  const verdict = await pending
  assert.equal(verdict.behavior, "deny")
  assert.equal(permissions.pending(requestId), false)
  assert.deepEqual(view().prompts, [])

  const said = engine.store.transcriptSince(RUN, 0).map((f) => f.text)
  assert.ok(said.some((t) => /stopped waiting/.test(t)), said.join(" | "))
})

test("a run kandy no longer knows about is denied rather than asked about", async () => {
  const { permissions, view } = fresh(10_000)
  const verdict = await permissions.request("r-gone", "Bash", { command: "pnpm test" })
  assert.equal(verdict.behavior, "deny")
  assert.deepEqual(view().prompts, [])
})
