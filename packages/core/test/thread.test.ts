import test from "node:test"
import assert from "node:assert/strict"
import { buildThread, renderBriefing } from "../dist/thread.js"

/*
 * The shapes below are the ones kandy actually stores. A run's frames come
 * back from the transcript table as {role, text, ts}; the run and note come
 * from the reducer. Nothing here is invented beyond the words.
 */

const note = {
  id: "note_1",
  boardId: "board_1",
  columnId: "col_1",
  title: "Add opencode and cursor adapters",
  body: "Both should stream JSON and report tokens.",
  status: "review",
  pos: "a0",
  agent: "claude",
  model: null,
  policy: "repo",
  branch: "kandy/note_1-adapters",
  worktree: null,
  stat: { files: 11, insertions: 1174, deletions: 22 },
  pr: null,
  outcome: null,
} as never

const run = (agent: string, turns: number) =>
  ({
    id: `run_${agent}`,
    noteId: "note_1",
    agent,
    agentSessionId: "sess_local",
    status: "succeeded",
    baseRef: "main",
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    error: null,
    costUsd: 1,
    tokens: 100,
    turns,
    model: "opus",
  }) as never

const f = (ts: number, role: string, text: string) =>
  ({ kind: "transcript", runId: "r", seq: ts, ts, role, text }) as never

test("the human's words survive; the agent's reading does not", () => {
  const thread = buildThread(note, [
    {
      run: run("claude", 12),
      frames: [
        f(1, "user", "Both should stream JSON and report tokens."), // the note body
        f(2, "assistant", "Reading the adapter interface."),
        f(3, "tool", "read apps/server/src/agents/types.ts"),
        f(4, "tool", "grep spawn"),
        f(5, "user", "cursor needs --trust or it exits zero"),
        f(6, "assistant", "Confirmed: without --trust it prints a banner and exits 0."),
      ],
    },
  ])

  const kinds = thread.arc.map((b) => b.kind)
  assert.deepEqual(kinds, ["ask", "decision"])
  assert.equal(thread.arc[0]!.text, "cursor needs --trust or it exits zero")
  // Tool calls are the bulk of a transcript and none of them is knowledge.
  assert.equal(
    thread.arc.some((b) => b.text.includes("grep")),
    false,
  )
})

test("the note body is not repeated back as if someone had asked it", () => {
  // The first user frame is the prompt kandy itself sent. The briefing prints
  // the note at the top, so echoing it as a steer would say it twice.
  const thread = buildThread(note, [
    { run: run("claude", 1), frames: [f(1, "user", "Both should stream JSON and report tokens.")] },
  ])
  assert.deepEqual(thread.arc, [])
})

test("only the last thing an agent says counts as its conclusion", () => {
  const thread = buildThread(note, [
    {
      run: run("claude", 3),
      frames: [
        f(1, "assistant", "I'll start with cursor."),
        f(2, "assistant", "Now opencode."),
        f(3, "assistant", "Both adapters are in. opencode prices its own runs."),
      ],
    },
  ])
  const decisions = thread.arc.filter((b) => b.kind === "decision")
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]!.text, "Both adapters are in. opencode prices its own runs.")
})

test("a failure is kept, and attributed to the agent that hit it", () => {
  const thread = buildThread(note, [
    {
      run: run("claude", 2),
      frames: [
        f(1, "error", "npm test failed: cursor.test.ts timed out after 30s"),
        f(2, "assistant", "The timeout is real; the fixture never closes stdin."),
      ],
    },
  ])
  const fail = thread.arc.find((b) => b.kind === "failure")
  assert.ok(fail)
  assert.equal(fail.agent, "claude")
  assert.match(fail.text, /timed out/)
})

test("two agents' work lands in one arc, in time order", () => {
  const thread = buildThread(note, [
    { run: run("claude", 5), frames: [f(1, "assistant", "Cursor adapter done.")] },
    { run: run("codex", 4), frames: [f(9, "assistant", "opencode adapter done.")] },
  ])
  assert.deepEqual(
    thread.arc.map((b) => b.agent),
    ["claude", "codex"],
  )
  assert.deepEqual(
    thread.runs.map((r) => r.agent),
    ["claude", "codex"],
  )
})

test("an interrupted run's half-thought is not presented as a finding", () => {
  // Straight from the real transcript that exposed this: a run that was
  // interrupted ends on "I'll explore the repo structure first", which reads
  // as a conclusion and is worse than silence.
  const interrupted = { ...(run("claude", 3) as object), status: "failed" } as never
  const thread = buildThread(note, [
    { run: interrupted, frames: [f(1, "assistant", "I'll explore the repo structure first.")] },
    { run: run("claude", 9), frames: [f(5, "assistant", "Both adapters are in and wired up.")] },
  ])
  const decisions = thread.arc.filter((b) => b.kind === "decision")
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]!.text, "Both adapters are in and wired up.")
})

test("but if nothing finished, the half-thought is all there is", () => {
  const interrupted = { ...(run("claude", 3) as object), status: "failed" } as never
  const thread = buildThread(note, [
    { run: interrupted, frames: [f(1, "assistant", "Got as far as the cursor adapter.")] },
  ])
  assert.equal(thread.open, "Got as far as the cursor adapter.")
})

test("an agent's own headings nest under the briefing's, rather than competing", () => {
  const thread = buildThread(note, [
    { run: run("claude", 2), frames: [f(1, "assistant", "Done.\n\n## What I did\n\nWrote both adapters.")] },
  ])
  const brief = renderBriefing(thread, "codex" as never)
  assert.match(brief, /#### What I did/)
  assert.equal(/\n## What I did/.test(brief), false)
})

test("a later failure does not un-finish work already on the branch", () => {
  // Real sequence: Claude finished, Cursor confirmed, then a Codex run died on
  // a revoked token. Eight files of completed work were still sitting on the
  // branch, and the briefing was telling the next agent to continue from there.
  const failedAfter = { ...(run("codex", 0) as object), status: "failed" } as never
  const thread = buildThread(note, [
    { run: run("claude", 32), frames: [f(1, "assistant", "Done — the model travels with the run.")] },
    { run: failedAfter, frames: [] },
  ])
  assert.equal(thread.settled, true)
  assert.match(renderBriefing(thread, "cursor" as never), /already applied on the branch/)
})

test("a finished note has nothing open", () => {
  const done = { ...(note as object), status: "done" } as never
  const thread = buildThread(done, [
    { run: run("claude", 2), frames: [f(1, "assistant", "Landed and merged.")] },
  ])
  assert.equal(thread.open, null)
})

test("the briefing tells the new agent it did not write this code", () => {
  const thread = buildThread(note, [
    {
      run: run("claude", 12),
      frames: [
        f(1, "assistant", "cursor needs --trust; without it the run exits zero having done nothing."),
        f(2, "error", "opencode is not installed on this machine"),
        f(3, "assistant", "Wrote opencode from its source rather than its docs."),
      ],
    },
  ])
  const brief = renderBriefing(thread, "codex" as never)

  assert.match(brief, /# Add opencode and cursor adapters/)
  assert.match(brief, /started by Claude Code, over 12 turns/)
  assert.match(brief, /You did not write any of the code below/)
  // The diff is named, never described — git carries it better than prose.
  assert.match(brief, /kandy\/note_1-adapters/)
  assert.match(brief, /11 files changed, \+1174 −22/)
  assert.match(brief, /What already failed/)
  assert.match(brief, /opencode is not installed/)
  // The note is in review off a succeeded run, so this reads as finished work
  // to be checked rather than a loose end to continue.
  assert.match(brief, /What they finished/)
})

test("handing a note back to the same agent does not lecture it about itself", () => {
  const thread = buildThread(note, [
    { run: run("claude", 4), frames: [f(1, "assistant", "Half done.")] },
  ])
  const brief = renderBriefing(thread, "claude" as never)
  assert.equal(/Before you/.test(brief), false)
  assert.match(brief, /What they finished/)
})

test("a note nobody has run yet briefs as just the task", () => {
  const brief = renderBriefing(buildThread(note, []), "claude" as never)
  assert.match(brief, /# Add opencode and cursor adapters/)
  assert.equal(/Before you|What they established|Where it stopped/.test(brief), false)
})

test("finished work is handed over to be checked, not continued", () => {
  /*
   * The live handoff that exposed this: Claude finished the job, the briefing
   * said "Where it stopped … Continue from there", and Cursor opened by
   * grepping for the symbol the briefing had just said was deleted. It was
   * doing as it was told.
   */
  const thread = buildThread(note, [
    { run: run("claude", 32), frames: [f(1, "assistant", "Done. The model travels with the run now.")] },
  ])
  assert.equal(thread.settled, true)

  const brief = renderBriefing(thread, "cursor" as never)
  assert.match(brief, /## What they finished/)
  assert.match(brief, /already applied on the branch/)
  assert.match(brief, /Check it rather than repeat it/)
  assert.equal(/Continue from there/.test(brief), false)
})

test("unfinished work still says continue", () => {
  const stopped = { ...(run("claude", 3) as object), status: "failed" } as never
  const nothingCommitted = { ...(note as object), stat: null } as never
  const thread = buildThread(nothingCommitted, [
    { run: stopped, frames: [f(1, "assistant", "Got as far as the cursor adapter.")] },
  ])
  assert.equal(thread.settled, false)
  assert.match(renderBriefing(thread, "codex" as never), /Continue from there/)
})
