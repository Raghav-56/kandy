import type { AgentId, Board, BoardView } from "./domain.js"
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
  "POST /notes/:id/delete": { req: {}; res: {} }
  "POST /notes/:id/run": { req: { agent?: AgentId }; res: { runId: RunId } }
  "POST /notes/:id/review": {
    req: { decision: "merge" | "discard" | "revise"; comment?: string }
    res: {}
  }
  "POST /runs/:id/cancel": { req: {}; res: {} }
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
}

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

export const ERROR_CODES = [
  "bad_request",
  "board_not_found",
  "note_not_found",
  "run_not_found",
  "agent_not_available",
  "repo_dirty",
  "worktree_failed",
  "invalid_transition",
  "internal",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
