import type { AgentId, NoteStatus, RunStatus } from "./domain.js"
import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

/** Envelope fields the server stamps on every event. */
export type EventMeta = {
  seq: number
  ts: number
}

export type KandyEventMap = {
  "board.created": { boardId: BoardId; name: string; repoPath: string }

  "column.created": { columnId: ColumnId; boardId: BoardId; name: string; pos: string }

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
  "run.blocked": { runId: RunId; requestId: string; kind: string; detail: string }
  "run.unblocked": { runId: RunId; requestId: string; decision: "allow" | "deny" }
  "run.finished": {
    runId: RunId
    noteId: NoteId
    status: RunStatus
    exitCode: number | null
    error: string | null
  }

  "review.opened": { noteId: NoteId; runId: RunId; branch: string }
  "review.decided": {
    noteId: NoteId
    decision: "merge" | "discard" | "revise"
    comment?: string
  }
}

export type KandyEventType = keyof KandyEventMap

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
