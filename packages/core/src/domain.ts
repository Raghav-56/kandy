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

/**
 * How much the agent is allowed to do.
 *
 * A worktree bounds what an agent can damage *inside the repo*. It does not
 * stop it touching $HOME, the network, or anything else on the machine — so
 * this is the user's decision to make, per note, with the tradeoff stated
 * plainly rather than a flag we quietly set for them.
 *
 * `repo`  — edit files freely; anything else needs approval it cannot get
 *           headlessly, so it is refused and surfaced.
 * `full`  — run anything. Fast and unblocked; only for work you'd have run
 *           yourself without reading it first.
 */
export type Policy = "repo" | "full"

export type Board = {
  id: BoardId
  name: string
  repoPath: string
  createdAt: number
}

/**
 * Lanes of the lifecycle. A column may declare which lane it represents, and
 * the server then moves notes into it as their status changes — a board whose
 * cards say REVIEW while sitting in Inbox is lying about the only thing it
 * exists to show.
 *
 * Columns without a lane are just user-made groupings; nothing moves into them
 * automatically.
 */
export type Lane = "inbox" | "queued" | "running" | "review" | "done"

export const LANE_OF: Record<NoteStatus, Lane> = {
  draft: "inbox",
  queued: "queued",
  running: "running",
  // Blocked work stays where the eye already is — beside what's in flight.
  blocked: "running",
  review: "review",
  // A failure is a thing to look at, not a thing to file away.
  failed: "review",
  done: "done",
}

export type Column = {
  id: ColumnId
  boardId: BoardId
  name: string
  pos: string
  lane: Lane | null
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
  policy: Policy
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
