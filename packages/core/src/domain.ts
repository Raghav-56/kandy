import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

export const AGENTS = ["claude", "codex", "cursor", "opencode", "gemini", "grok"] as const
export type AgentId = (typeof AGENTS)[number]

/**
 * `blocked` is the only status that legitimately demands attention. Every
 * client should treat it as such — it is the difference between a board you
 * can walk away from and one you have to watch.
 */
export const NOTE_STATUSES = [
  "draft",
  "queued",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

export type RunStatus =
  | "starting"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"

export type Board = {
  id: BoardId
  name: string
  repoPath: string
  createdAt: number
}

export type Column = {
  id: ColumnId
  boardId: BoardId
  name: string
  pos: string
}

export type Note = {
  id: NoteId
  boardId: BoardId
  columnId: ColumnId
  title: string
  /** The prompt handed to the agent. */
  body: string
  status: NoteStatus
  pos: string
  agent: AgentId | null
  runId: RunId | null
  /** Set when a run starts; the deliverable. */
  branch: string | null
  worktree: string | null
  createdAt: number
  updatedAt: number
}

export type Run = {
  id: RunId
  noteId: NoteId
  agent: AgentId
  /** The agent CLI's own session id, captured from its stream. Needed for resume. */
  agentSessionId: string | null
  status: RunStatus
  /** Commit the worktree branched from, resolved at queue time and never re-resolved. */
  baseRef: string | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error: string | null
}

/** What a client renders. A projection of the event log, never written directly. */
export type BoardView = {
  board: Board
  columns: Column[]
  notes: Note[]
  runs: Run[]
  /** Sequence number this view reflects; the client streams from here. */
  seq: number
}
