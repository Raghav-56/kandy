# Data model

## Entities

**Board** — a workspace scoped to one git repository. Has columns and notes.

**Column** — an ordered lane. Default columns map to the note lifecycle, but they are just
labels; the authoritative status lives on the note.

**Note** — the unit of work. The whole product is this record.

```ts
type Note = {
  id: NoteId
  boardId: BoardId
  title: string
  body: string              // the prompt given to the agent
  status: NoteStatus
  pos: string               // fractional index for ordering within a column
  columnId: ColumnId

  agent: AgentId | null     // "claude" | "codex" | "cursor" | ...
  run: RunRef | null        // current or last execution

  branch: string | null     // kandy/<id>-<slug>, set when a run starts
  worktree: string | null   // absolute path, set when a run starts

  createdAt: number
  updatedAt: number
}

type NoteStatus =
  | "draft"      // being written; nothing runs
  | "queued"     // accepted for execution, waiting for a slot
  | "running"    // an agent process is live
  | "blocked"    // waiting on a human decision (permission, question)
  | "review"     // finished; branch + diff awaiting a verdict
  | "done"       // merged or accepted
  | "failed"     // the run errored out
```

`blocked` is the most important status in the system. It is the only one that legitimately
demands attention, and the UI should treat it as such everywhere.

**Run** — one execution of a note by an agent. A note may have several over its life (retry,
send-back-with-comment). Holds the agent's own session id so we can resume it.

```ts
type Run = {
  id: RunId
  noteId: NoteId
  agent: AgentId
  agentSessionId: string | null   // for --resume; captured from the agent's stream
  status: "starting" | "running" | "blocked" | "succeeded" | "failed" | "cancelled"
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error: string | null
}
```

## Ordering

Notes are ordered by a **fractional index** string (`pos`), not an integer. Moving a note
between two others is a single write computing a key between its neighbours — no renumbering
the column, no write amplification, no lost-update races when two clients drag at once.

This is also the representation a list-CRDT would need later, so choosing it now keeps the door
to multiplayer open at no cost.

## Events

The log is the truth; everything above is a projection of it.

```
board.created        { boardId, name, repoPath }
column.created       { columnId, boardId, name, pos }
note.created         { noteId, boardId, columnId, title, body, pos }
note.edited          { noteId, title?, body? }
note.moved           { noteId, columnId, pos }
note.assigned        { noteId, agent }
note.deleted         { noteId }

run.requested        { runId, noteId, agent }
run.started          { runId, worktree, branch, pid }
run.output           { runId, seq, channel, text }      ← high volume
run.tool             { runId, tool, input, status }
run.session          { runId, agentSessionId }
run.blocked          { runId, requestId, kind, detail }
run.unblocked        { runId, requestId, decision }
run.finished         { runId, status, exitCode, error? }

review.opened        { noteId, runId, branch, stats }
review.decided       { noteId, decision: "merge"|"discard"|"revise", comment? }
```

Every event carries `seq` (monotonic, server-assigned), `ts`, and `id`. Clients reconnect with
`Last-Event-ID` and receive everything after it.

## The one scaling concern

`run.output` is high-volume — an agent can emit thousands of lines. Storing every line in the
same table as domain events will bloat the log and slow replay.

**Decision:** output goes to a separate append-only table (or a per-run file) keyed by
`(runId, seq)`, and the domain log carries only a watermark. Replay of the board never touches
output; opening a note's transcript is a separate paginated query. Getting this wrong is the
most likely cause of the app feeling slow at month three.
