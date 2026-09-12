import type { AgentId, Board, BoardView, Policy } from "./domain.js"
import type { TranscriptFrame } from "./events.js"
import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

/**
 * The wire contract. The server validates against it, clients are typed from
 * it. Both opencode and t3code converged on a shared contracts package as
 * their anti-drift mechanism; this is ours.
 */
export type Commands = {
  "POST /boards": { req: { name: string; repoPath: string }; res: { board: Board } }
  "POST /notes": {
    req: { boardId: BoardId; columnId: ColumnId; title: string; body?: string }
    res: { noteId: NoteId }
  }
  "POST /notes/:id/edit": { req: { title?: string; body?: string }; res: {} }
  "POST /notes/:id/move": { req: { columnId: ColumnId; before?: NoteId; after?: NoteId }; res: {} }
  "POST /notes/:id/assign": { req: { agent: AgentId }; res: {} }
  "POST /notes/:id/policy": { req: { policy: Policy }; res: {} }
  "POST /notes/:id/delete": { req: {}; res: {} }
  "POST /notes/:id/run": { req: { agent?: AgentId }; res: { runId: RunId } }
  "POST /notes/:id/review": {
    req: { decision: "merge" | "discard" | "revise"; comment?: string }
    res: {}
  }
  "POST /runs/:id/cancel": { req: {}; res: {} }
  /** Steer a note: talk to the live agent, or queue a follow-up that resumes it. */
  "POST /notes/:id/message": { req: { text: string }; res: { delivery: Delivery } }
  "POST /runs/:id/respond": {
    req: { requestId: string; decision: "allow" | "deny"; comment?: string }
    res: {}
  }
}

export type Queries = {
  "GET /health": { res: { version: string; uptime: number; pid: number } }
  "GET /boards": { res: { boards: Board[] } }
  "GET /boards/:id/view": { res: BoardView }
  "GET /agents": { res: { agents: AgentInfo[] } }
  "GET /runs/:id/output": { res: { lines: OutputLine[]; nextAfter: number | null } }
  "GET /runs/:id/transcript": { res: { frames: TranscriptFrame[]; nextAfter: number | null } }
  /**
   * `capturedAt` is null for a diff read live from the worktree, and the time
   * of the snapshot for one replayed after the worktree was removed.
   */
  "GET /notes/:id/diff": {
    res: { diff: string; stat: string; branch: string | null; capturedAt: number | null }
  }
  /** Validate a path before offering to make a board of it. */
  "GET /repo/check": { res: RepoCheck }
}

/**
 * How a steering message reached the agent. Surfaced to the user because the
 * difference matters: "live" lands mid-turn, "queued" starts a new run.
 */
export type Delivery = "live" | "queued"

export type AgentInfo = {
  id: AgentId
  installed: boolean
  /** Best-effort: whether a credential exists. Never reads the credential. */
  authed: boolean
  version: string | null
}

export type OutputLine = {
  seq: number
  ts: number
  channel: "stdout" | "stderr"
  text: string
}

/**
 * Every command returns the sequence number of the event it produced. A client
 * wanting read-your-writes waits for that seq on the event stream rather than
 * optimistically merging a response body — one code path for all state change.
 */
export type Ok<T> = { ok: true; seq: number } & T
export type Err = { ok: false; error: { code: ErrorCode; message: string; detail?: unknown } }

export type RepoCheck = {
  path: string
  exists: boolean
  isRepo: boolean
  /** Uncommitted changes — notes branch from HEAD and won't see them. */
  dirty: boolean
  head: string | null
  branch: string | null
  name: string | null
  error: string | null
}

export const ERROR_CODES = [
  "bad_request",
  "board_not_found",
  "note_not_found",
  "run_not_found",
  "agent_not_available",
  "repo_dirty",
  "worktree_failed",
  "not_a_repo",
  "run_not_live",
  "invalid_transition",
  "internal",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
