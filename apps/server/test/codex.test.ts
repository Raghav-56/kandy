import test from "node:test"
import assert from "node:assert/strict"

import { codex, configuredModel } from "../dist/agents/codex.js"

/** Every line the adapter turns into events, as Codex actually emits them. */
const line = (o: unknown) => JSON.stringify(o)

test("thread.started carries the session id, which Codex calls thread_id", () => {
  // Looking for `session_id` here is why resume and steering silently did
  // nothing for every Codex note ever run.
  const out = codex.parse(line({ type: "thread.started", thread_id: "01a0-abc" }))
  assert.deepEqual(out, [{ kind: "session", sessionId: "01a0-abc" }])
})

test("turn.completed reports usage with the cache buckets backed out", () => {
  const out = codex.parse(
    line({
      type: "turn.completed",
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 600,
        cache_write_input_tokens: 100,
        output_tokens: 50,
      },
    }),
  )
  const usage = out.find((e) => e.kind === "usage")
  assert.ok(usage && usage.kind === "usage")
  // Codex's input_tokens includes the cached buckets; billing each at its own
  // rate means removing them from the plain input count.
  assert.deepEqual(usage.usage, { input: 300, output: 50, cacheRead: 600, cacheWrite: 100 })
  assert.equal(usage.tokens, 1050)
  assert.equal(usage.costUsd, null, "Codex reports no dollar figure")
  assert.ok(out.some((e) => e.kind === "turn_end"))
})

test("agent_message becomes text only once it has completed", () => {
  const item = { id: "i1", type: "agent_message", text: "OK" }
  assert.deepEqual(codex.parse(line({ type: "item.started", item })), [])
  assert.deepEqual(codex.parse(line({ type: "item.completed", item })), [
    { kind: "text", text: "OK" },
  ])
})

test("a command that ran and failed is a tool failure, not a refusal", () => {
  const out = codex.parse(
    line({
      type: "item.completed",
      item: { id: "i", type: "command_execution", command: "npm test", exit_code: 1, aggregated_output: "1 failing" },
    }),
  )
  assert.equal(out[0]?.kind, "tool")
})

test("output mentioning permissions does not block a command that succeeded", () => {
  // The false-positive machine this replaces: `cat docs/05-agent-auth.md`
  // marked a note blocked because the document discusses permissions.
  const out = codex.parse(
    line({
      type: "item.completed",
      item: {
        id: "i",
        type: "command_execution",
        command: "cat docs/05-agent-auth.md",
        exit_code: 0,
        aggregated_output: "We spawn the CLI... permission ... requires approval ...",
      },
    }),
  )
  assert.equal(out[0]?.kind, "tool")
  assert.ok(!out.some((e) => e.kind === "blocked"))
})

test("a refused command is blocked", () => {
  const out = codex.parse(
    line({
      type: "item.completed",
      item: {
        id: "i7",
        type: "command_execution",
        command: "rm -rf /",
        exit_code: 1,
        aggregated_output: "operation not permitted",
      },
    }),
  )
  assert.equal(out[0]?.kind, "blocked")
})

test("operational notices are not painted as errors", () => {
  // Codex re-announces these every turn; red that means nothing teaches people
  // to ignore red.
  const out = codex.parse(
    line({
      type: "item.completed",
      item: { id: "i", type: "error", message: "`--dangerously-bypass-hook-trust` is enabled." },
    }),
  )
  assert.equal(out[0]?.kind, "usage", "a notice, not a failure")
})

test("a genuine error is an error", () => {
  const out = codex.parse(
    line({ type: "item.completed", item: { id: "i", type: "error", message: "model not supported" } }),
  )
  assert.equal(out[0]?.kind, "error")
})

test("reasoning and todo items are dropped from the transcript", () => {
  for (const type of ["reasoning", "todo_list"]) {
    assert.deepEqual(codex.parse(line({ type: "item.completed", item: { id: "i", type } })), [])
  }
})

test("a non-JSON line survives as text instead of throwing", () => {
  assert.deepEqual(codex.parse("not json at all"), [{ kind: "text", text: "not json at all" }])
  assert.deepEqual(codex.parse("   "), [])
})

test("resume uses a different flag set than a fresh exec", () => {
  // `exec resume` accepts neither -s nor -C and fails the whole run on either.
  const fresh = codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo" })
  assert.ok(fresh.args.includes("-s"))
  assert.ok(fresh.args.includes("-C"))

  const resumed = codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo", resume: "t1" })
  assert.ok(resumed.args.includes("resume"))
  assert.ok(!resumed.args.includes("-s"), "-s is rejected by exec resume")
  assert.ok(!resumed.args.includes("-C"), "-C is rejected by exec resume")
})

test("full access asks for it explicitly on both paths", () => {
  const fresh = codex.spawn({ cwd: "/wt", prompt: "go", policy: "full" })
  assert.ok(fresh.args.includes("danger-full-access"))
  const resumed = codex.spawn({ cwd: "/wt", prompt: "go", policy: "full", resume: "t1" })
  assert.ok(resumed.args.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("a pinned model is passed through", () => {
  const spec = codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo", model: "gpt-5.3-codex" })
  assert.ok(spec.args.includes("-m"))
  assert.ok(spec.args.includes("gpt-5.3-codex"))
})

test("the run's model is what prices it, and runs do not cross wires", () => {
  // The adapter is a singleton shared by every run, so a model stashed on it
  // by spawn() meant whichever run started last priced both of them.
  const turn = line({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } })
  codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo", model: "gpt-5.3-codex" })
  codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo", model: "o4-mini" })

  const first = codex.parse(turn, { model: "gpt-5.3-codex" }).find((e) => e.kind === "usage")
  const second = codex.parse(turn, { model: "o4-mini" }).find((e) => e.kind === "usage")
  assert.ok(first?.kind === "usage" && second?.kind === "usage")
  assert.equal(first.model, "gpt-5.3-codex")
  assert.equal(second.model, "o4-mini")
})

test("a run with no pinned model falls back to Codex's own configured one", () => {
  const turn = line({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } })
  for (const usage of [
    codex.parse(turn).find((e) => e.kind === "usage"),
    codex.parse(turn, {}).find((e) => e.kind === "usage"),
  ]) {
    assert.ok(usage?.kind === "usage")
    assert.equal(usage.model, configuredModel())
  }
})

test("codex never gets an open stdin", () => {
  // It blocks forever on "Reading additional input from stdin..." otherwise.
  assert.equal(codex.spawn({ cwd: "/wt", prompt: "go", policy: "repo" }).stdin, undefined)
  assert.equal(codex.live, undefined, "codex accepts no mid-run steering")
})
