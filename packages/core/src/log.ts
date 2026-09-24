import type { BoardView } from "./domain.js"
import type { PendingEvent, TranscriptFrame, TranscriptRole } from "./events.js"

/**
 * Everything a runner needs from the log, and nothing else.
 *
 * The runner used to hold an `Engine` and reach through it — `engine.emit`,
 * `engine.view`, and four calls straight into `engine.store`. That is fine
 * while the thing that coordinates and the thing that executes are the same
 * process, which is what kandy has always been and what every comparable tool
 * still is. It stops being fine the moment the executing half is on someone
 * else's laptop.
 *
 * This interface is that seam, and it is deliberately the whole of it. A local
 * runner gets an implementation that is the `Engine` it already had; a remote
 * one gets a WebSocket to a hub. **Nothing else about the runner changes** —
 * which is the point, because the alternative was a second runner that drifts
 * from the first.
 *
 * ## Why the writes do not return anything
 *
 * `emit` handed back the stamped event, and no caller used it. Kept that way
 * on purpose: over a network the sequence number arrives later than the call
 * does, so a write that promised its seq would either block the runner on a
 * round trip it has no use for, or hand back a number it had to invent. The
 * hub is the single writer and the seq is its business.
 *
 * ## Why only two things are async
 *
 * Writes are one-way and can be posted. Reads cannot: `history` is the one
 * place a runner needs an answer from a log it may not hold, which is exactly
 * the handoff case — picking up a note a teammate's agent started means
 * reading a transcript that was never on this machine.
 *
 * `view` is the exception that proves it. It stays synchronous because a
 * remote runner keeps its own replica folded from the event stream it is
 * already subscribed to, so the board it needs is local either way. A runner
 * that had to ask the hub for a board before every decision would be a
 * terminal, not a runner.
 */
export interface Log {
  /**
   * Append a domain event.
   *
   * `actor` is stamped by whoever owns the log, never by the caller — see
   * `EventMeta`. A runner says what happened; it does not get to say who.
   */
  emit(pending: PendingEvent): void

  /** Persist a transcript frame and push it to anyone watching. */
  say(runId: string, role: TranscriptRole, text: string, meta?: string): void

  /** Live-only "what this run is doing right now". Never persisted. */
  activity(runId: string, tool: string, detail: string): void

  /** Raw agent output, kept apart from the transcript because of its volume. */
  output(runId: string, channel: "stdout" | "stderr", text: string): void

  /** The diff a finished run produced, snapshotted before its worktree goes. */
  saveDiff(
    noteId: string,
    snapshot: { runId: string; branch: string; stat: string; diff: string },
  ): void

  /** The current board, from this process's own projection. */
  view(boardId: string): BoardView | null

  /**
   * A past run's transcript, for briefing the agent taking over from it.
   *
   * Asked for by run rather than in bulk because a handoff is the only thing
   * that needs it, and most runs are not handoffs.
   */
  history(runId: string): Promise<TranscriptFrame[]>
}
