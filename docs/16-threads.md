# Threads, and moving one between agents

*Nobody should be stuck.* A note that has been running on Claude Code should be continuable on
Codex — by you, on your machine, or by a teammate on theirs. This is the format that makes that
possible and the honest account of what survives the trip.

Build this **before** the hub in [`15-remote.md`](15-remote.md). It is the part with real
unknowns, it is useful on its own — *"Claude is stuck, give it to Codex"* needs no network at
all — and once it works, multiplayer is the same operation with a network in the middle.

## Three tiers, and only one of them is lossless

| What moves | Fidelity | How |
| --- | --- | --- |
| **The code** | Perfect | Git. The branch already exists; push it and the next runner checks it out. |
| **The thread** | Good, lossy | A briefing rendered from frames kandy already stores. |
| **The session** | None | `session_id` and `thread_id` are local, model-specific, and unrecoverable. |

So the claim stays the one [`11-going-multiplayer.md`](11-going-multiplayer.md) settled on:
**hand off the thread, not resume the session.** Codex cannot ingest Claude's session. It can
ingest a good briefing plus a branch, and often that is better, because the handoff is a chance
to correct the framing rather than inherit it.

## We already have the neutral form

This is the part worth knowing before designing anything: **every adapter already normalises to
the same frames.** Claude Code, Codex, Cursor, opencode and Aider each emit `text`, `tool`,
`usage`, `blocked`, `error`, `session` and `turn_end`, and the store persists
`(run_id, seq, ts, role, text, meta)` in `transcript`, with no trace of which CLI produced it.

Nobody else can do this cheaply, because nobody else treats the transcript as a domain object —
everyone else has a pty and a scrollback. The translation layer is therefore **a renderer over
data we already keep**, not a new pipeline.

## The Thread document

Derived, never authored. It is a projection of the log and the transcript for one note, in the
same spirit as every other projection in kandy.

```ts
type Thread = {
  /** The original ask, verbatim. The next agent should see what was wanted. */
  note: { id: NoteId; title: string; body: string }
  /** Where the code is. The receiving runner needs nothing else to get it. */
  repo: { key: string; branch: string; baseRef: string; head: string }
  /** Who has worked on it, on what, and what it cost them. */
  runs: { agent: AgentId; model: string | null; status: RunStatus; turns: number | null }[]
  /** The distilled conversation, oldest first. */
  arc: Beat[]
  /** What changed, from the diff we already compute. */
  files: { path: string; insertions: number; deletions: number; status: string }[]
  /** Refusals worth inheriting — a sandbox denial is a fact about the task. */
  blocked: { tool?: string; command?: string; detail: string }[]
  /** The last thing said, if the run ended without resolving it. */
  open: string | null
}

type Beat = {
  at: number
  who: "human" | "agent"
  agent?: AgentId
  kind: "ask" | "decision" | "finding" | "action" | "failure"
  text: string
}
```

### How the arc is built

Mechanically first, because mechanical is deterministic and testable:

- every **human** message — the asks and the steering, verbatim;
- each run's **closing assistant message** — we already extract this for PR bodies, where it
  turned `_No description given._` into 1,914 useful characters;
- every `blocked` frame and every `error` frame;
- tool calls **only** when they failed, or when they changed a file.

Everything else is left out on purpose. A 48-turn transcript is both too long to hand an agent
and the wrong shape — mostly `read` and `grep` noise that the next agent will redo anyway
because its own context is empty. The full transcript stays readable in the UI; the arc is what
gets handed over.

A model-written summary is an obvious later upgrade. Do not start there: it is unverifiable, it
costs a call, and it will hide whether the mechanical extraction was any good.

## Rendering a briefing

The Thread is agent-neutral; the briefing is not. Render per target, in this order, because it
is the order that stops an agent re-deriving what is already known:

1. **The task** — the note's title and body.
2. **Where the code stands** — branch, base, and the file list with line counts. Never describe
   the diff in prose; the agent can read it and git carries it perfectly.
3. **What has been decided** — the `decision` and `finding` beats, attributed (*"Claude
   established that …"*), so the next agent knows what is settled versus what is assumed.
4. **What failed** — `failure` and `blocked` beats. A sandbox refusal or a flaky test is a fact
   about the task, and rediscovering it costs a turn.
5. **What is open** — the single next thing, stated as an instruction.

Then a line saying plainly that a different tool did the earlier work, because an agent that
believes it wrote code it has not read will act on a memory it does not have.

## Wiring it in

Almost nothing new. `runner.ts:389` already passes `resume` **only** when continuing in an
existing worktree — the comment says why: *"a fresh worktree means a fresh filesystem, and an
agent whose memory disagrees with what's on disk wastes a turn rediscovering that."* The same
reasoning generalises exactly:

> **Never resume across a change of agent.** The session id belongs to another tool. Withhold
> `resume`, pass the rendered briefing as the run's prompt, and let the worktree carry the code.

So a cross-agent continue is: change the note's agent, render, run. The spawn path, the prompt
channel, the worktree reuse and the transcript all work already.

Same agent, same machine, same worktree still uses native resume — it is strictly better, and
there is no reason to give it up.

## How we know it worked

Not "it produced output." The test is whether the receiving agent **re-derives what the previous
one established**. That is measurable with what we already record:

- Does its first turn re-read files the previous run had already read and reported on?
- Does it re-run a command that the arc says already failed, and fail the same way?
- Does it restate the plan instead of continuing it?

Run the same note twice on the same branch — once continued with a briefing, once started cold
with only the note body — and compare turns, tokens and cost. If the briefing is not buying a
measurable reduction, it is not working, however good it reads.

## Open

- **Does the arc cross the wire on a handoff, or only the briefing?** [`12-spike-git-share.md`](12-spike-git-share.md)
  sized sharing *without* transcripts and says so: those numbers describe the version that does
  not deliver the pitch. The arc is far smaller than a transcript and may be the right unit to
  replicate, with the full transcript staying on the machine that produced it.
- **Secrets.** A transcript contains whatever `bash` printed, which on a bad day is a token. The
  arc's mechanical rules cut most tool output, but "most" is not a security property. Decide
  before anything is shared off-machine.
- **Attachments.** Files staged onto a note live in the state dir, not in git. They have to
  travel or the briefing references things the next machine does not have.
- **Cost attribution.** Each runner pays with its own subscription, which is the point — but
  the usage page currently sums a board. Once two people run notes on one board, "what did this
  cost" needs a per-person answer.
