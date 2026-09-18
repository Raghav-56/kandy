import test from "node:test"
import assert from "node:assert/strict"
import { priorRuns, promptForRun } from "../dist/handoff.js"

const note = {
  id: "note_1",
  title: "Add the cursor adapter",
  body: "It must pass --trust.",
  status: "review",
  branch: "kandy/note_1",
  stat: { files: 2, insertions: 40, deletions: 1 },
} as never

const run = (agent: string, id = `run_${agent}`) =>
  ({ id, noteId: "note_1", agent, status: "succeeded", turns: 4, model: null }) as never

const say = (text: string, role = "assistant") =>
  [{ kind: "transcript", runId: "r", seq: 1, ts: 1, role, text }] as never

test("a note nobody has run gets the note, not a briefing", () => {
  const p = promptForRun(note, [], "claude" as never, () => say("unused"))
  assert.equal(p, "Add the cursor adapter\n\nIt must pass --trust.")
})

test("the same agent continuing its own work gets the note", () => {
  // Its own session is a better memory than anything we could write down, and
  // the runner resumes it — so a briefing here would be both redundant and a
  // second, worse account of what it already remembers.
  const p = promptForRun(note, [run("claude")], "claude" as never, () => say("Half done."))
  assert.equal(/Before you/.test(p), false)
  assert.equal(p, "Add the cursor adapter\n\nIt must pass --trust.")
})

test("a different agent gets the briefing", () => {
  const p = promptForRun(note, [run("claude")], "codex" as never, () =>
    say("The sandbox refuses without --trust; I added it."),
  )
  assert.match(p, /# Add the cursor adapter/)
  assert.match(p, /started by Claude Code/)
  assert.match(p, /You did not write any of the code below/)
  assert.match(p, /kandy\/note_1/)
  assert.match(p, /sandbox refuses without --trust/)
})

test("a handover with nothing worth saying falls back to the note", () => {
  // A run that produced only tool calls has no beats. A briefing made of
  // headings and no content is noise the next agent reads past to reach the
  // task it could have been given directly.
  const p = promptForRun(note, [run("claude")], "codex" as never, () => say("read file", "tool"))
  assert.equal(p, "Add the cursor adapter\n\nIt must pass --trust.")
})

test("an unreadable transcript costs the briefing, never the run", () => {
  const p = promptForRun(note, [run("claude")], "codex" as never, () => {
    throw new Error("database is locked")
  })
  assert.equal(p, "Add the cursor adapter\n\nIt must pass --trust.")
})

test("the third agent hears about both of the first two", () => {
  const frames: Record<string, unknown> = {
    run_claude: say("Cursor adapter written against a real captured stream."),
    run_codex: say("opencode adapter written from its source."),
  }
  const p = promptForRun(
    note,
    [run("claude"), run("codex")],
    "cursor" as never,
    (id) => frames[id] as never,
  )
  assert.match(p, /started by Claude Code and Codex/)
  assert.match(p, /Cursor adapter written against/)
  assert.match(p, /opencode adapter written from/)
})

test("the run being started is not one of its own predecessors", () => {
  /*
   * The bug this exists to stop, found by a real handoff and not by any test
   * here: `run.requested` is emitted when a run is queued, so the board's run
   * list already contains the run about to start — as the last entry.
   *
   * Ask "has the agent changed?" against that list and the answer is always
   * no. Both halves of the handoff were dead in exactly that way: the previous
   * agent's session id was passed to a different agent as --resume, and the
   * briefing was never rendered once. Codex died on it outright — "no rollout
   * found for thread id" — because it had been handed Cursor's session.
   */
  const runs = [
    { id: "run_claude", noteId: "note_1", agent: "claude" },
    { id: "run_cursor", noteId: "note_1", agent: "cursor" },
    { id: "run_codex", noteId: "note_1", agent: "codex" }, // queued, not started
    { id: "run_other", noteId: "note_2", agent: "claude" },
  ] as never[]

  const past = priorRuns(runs, "note_1", "run_codex")
  assert.deepEqual(
    past.map((r: { id: string }) => r.id),
    ["run_claude", "run_cursor"],
    "its own row is gone, and another note's rows never counted",
  )

  // And the consequence: with the current run excluded, this reads as a
  // handover and produces a briefing. Including it, the last agent is codex,
  // codex is starting, and the whole feature silently does nothing.
  const p = promptForRun(note, past, "codex" as never, () => say("Cursor finished the adapters."))
  assert.match(p, /started by Claude Code and Cursor/)
  assert.match(p, /Cursor finished the adapters/)
})
