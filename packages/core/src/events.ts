import type {
  AgentId,
  Attribution,
  CostSource,
  DiffStat,
  Lane,
  NoteStatus,
  Policy,
  PullRequest,
  RunStatus,
} from "./domain.js"
import type { PermissionRule } from "./permission.js"
import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

/** Envelope fields the server stamps on every event. */
export type EventMeta = {
  seq: number
  ts: number
}

export type KandyEventMap = {
  "board.created": {
    boardId: BoardId
    name: string
    repoPath: string
    setup?: string | null
    carry?: string[]
    models?: Partial<Record<AgentId, string>>
    defaultPolicy?: Policy
    attribution?: Attribution
  }
  "board.setup": { boardId: BoardId; setup: string | null; carry?: string[] }
  /** Removes the board from kandy. The repository itself is never touched. */
  "board.removed": { boardId: BoardId }
  "board.models": { boardId: BoardId; models: Partial<Record<AgentId, string>> }
  /**
   * What notes created on this board start as. Applies from here forward —
   * notes already on the board keep whatever policy they have.
   */
  "board.policy": { boardId: BoardId; defaultPolicy: Policy }
  /** Whether this board's commits carry trailers and its PRs carry a footer. */
  "board.attribution": { boardId: BoardId; attribution: Attribution }

  "column.created": {
    columnId: ColumnId
    boardId: BoardId
    name: string
    pos: string
    lane?: Lane | null
  }

  "note.created": {
    noteId: NoteId
    boardId: BoardId
    columnId: ColumnId
    title: string
    body: string
    pos: string
  }
  "note.edited": { noteId: NoteId; title?: string; body?: string }
  "note.moved": { noteId: NoteId; columnId: ColumnId; pos: string }
  "note.assigned": { noteId: NoteId; agent: AgentId }
  "note.model": { noteId: NoteId; model: string | null }
  "note.policy": { noteId: NoteId; policy: Policy }
  "note.status": { noteId: NoteId; status: NoteStatus }
  "note.deleted": { noteId: NoteId }

  "run.requested": { runId: RunId; noteId: NoteId; agent: AgentId }
  "run.started": {
    runId: RunId
    noteId: NoteId
    worktree: string
    branch: string
    baseRef: string
    pid: number
  }
  /** High volume. Stored apart from the domain log — see docs/02-data-model.md. */
  "run.output": { runId: RunId; channel: "stdout" | "stderr"; text: string }
  "run.tool": { runId: RunId; tool: string; status: "started" | "completed" | "failed" }
  "run.session": { runId: RunId; agentSessionId: string }
  /**
   * The agent could not do something.
   *
   * Two different situations share this event, told apart by `ask`. Without
   * it, the agent was auto-denied and has already moved on — the historical
   * meaning of `blocked`. With it, the agent is standing still and a
   * `run.unblocked` is what lets it continue.
   */
  "run.blocked": {
    runId: RunId
    requestId: string
    kind: string
    detail: string
    /** Tool name as the agent spells it, when we know it. */
    tool?: string
    /** The exact command, verbatim. What the user is shown and approves. */
    command?: string
    /** True when something is actually waiting on an answer. */
    ask?: boolean
  }
  "run.unblocked": {
    runId: RunId
    requestId: string
    /**
     * `timeout` is a denial too, but a different story: nobody answered. It is
     * recorded as itself so a transcript can say so rather than implying
     * someone made a decision.
     */
    decision: "allow" | "deny" | "timeout"
    /** What the user said to do instead, on a denial. */
    comment?: string
    /** Whether the answer also wrote a rule for this note. */
    scope?: "once" | "note"
  }
  /** A standing answer for this note: "don't ask me about that again". */
  "note.permission": { noteId: NoteId; rule: PermissionRule }
  "run.finished": {
    runId: RunId
    noteId: NoteId
    status: RunStatus
    exitCode: number | null
    error: string | null
  }

  "review.opened": { noteId: NoteId; runId: RunId; branch: string; stat: DiffStat }
  /** A PR was opened from this note, or its state changed on the forge. */
  "note.pr": { noteId: NoteId; pr: PullRequest | null }
  "run.metrics": {
    runId: RunId
    costUsd: number | null
    tokens: number | null
    turns: number | null
    model?: string | null
    source?: CostSource
  }
  "review.decided": {
    noteId: NoteId
    decision: "merge" | "discard" | "revise"
    comment?: string
  }
}

export type KandyEventType = keyof KandyEventMap

/**
 * Transcript frames: what the agent is saying and doing, right now.
 *
 * These are deliberately NOT domain events. They are high volume, they are
 * persisted in their own table, and putting them in the log would make board
 * replay proportional to how chatty the agents were.
 *
 * They stream over the same SSE connection but carry no `id:` field, so they
 * never move the client's Last-Event-ID. A reconnect resumes the domain log
 * exactly where it left off and refetches the transcript of whatever note is
 * open — which is the only place transcript is ever displayed.
 */
export type TranscriptRole = "assistant" | "user" | "tool" | "system" | "error"

export type TranscriptFrame = {
  kind: "transcript"
  runId: RunId
  seq: number
  ts: number
  role: TranscriptRole
  text: string
  /** Tool name for `tool` frames; agent-specific detail otherwise. */
  meta?: string
}

/**
 * What a run is doing *right now*.
 *
 * Deliberately ephemeral: not logged, not persisted, no SSE id. A tool call a
 * second would bloat the domain log for information that is worthless ten
 * seconds later. Clients hold it in memory and lose it on reconnect, which is
 * correct — "currently doing X" has no meaning for a run you weren't watching.
 */
export type ActivityFrame = {
  kind: "activity"
  runId: RunId
  ts: number
  tool: string
  detail: string
}

export type StreamFrame = KandyEvent | TranscriptFrame | ActivityFrame

export function isTranscript(f: StreamFrame): f is TranscriptFrame {
  return "kind" in f && f.kind === "transcript"
}

export function isActivity(f: StreamFrame): f is ActivityFrame {
  return "kind" in f && f.kind === "activity"
}

/** True for frames that are live-only and must not carry an SSE id. */
export function isEphemeral(f: StreamFrame): f is TranscriptFrame | ActivityFrame {
  return "kind" in f
}

export type KandyEvent<T extends KandyEventType = KandyEventType> = {
  [K in T]: EventMeta & { type: K; data: KandyEventMap[K] }
}[T]

/** An event before the server assigns it a sequence number. */
export type PendingEvent<T extends KandyEventType = KandyEventType> = {
  [K in T]: { type: K; data: KandyEventMap[K] }
}[T]

export function event<T extends KandyEventType>(
  type: T,
  data: KandyEventMap[T],
): PendingEvent<T> {
  return { type, data } as PendingEvent<T>
}
