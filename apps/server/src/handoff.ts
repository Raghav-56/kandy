import { buildThread, promptFor, renderBriefing } from "@kandy/core"
import type { AgentId, Note, Run, TranscriptFrame } from "@kandy/core"

/**
 * What to ask the agent, given who worked on this before.
 *
 * Separated from the runner because it is a decision rather than a side
 * effect, and because the interesting cases — a handover with nothing worth
 * saying, a transcript that will not load — are the ones worth testing and the
 * hardest to reach through a spawning runner.
 *
 * `frames` is injected for the same reason: the caller has a store, a test has
 * an array, and this needs neither.
 */
/**
 * The runs that came *before* this one.
 *
 * Its own line, and tested, because getting it wrong is silent. `run.requested`
 * is emitted when a run is queued rather than when it starts, so the board's
 * run list already contains the run being started — and it is the last one.
 * Ask "did the agent change?" against that list and the answer is always no,
 * because the last run is the one you are about to start.
 *
 * That made both halves of the handoff dead: the session id of whichever agent
 * went last was passed to a different agent as `--resume`, and the briefing was
 * never rendered at all. Codex failed outright on it — `no rollout found for
 * thread id` — because it was handed Cursor's session.
 */
export function priorRuns<T extends { id: string; noteId: string }>(
  runs: readonly T[],
  noteId: string,
  currentRunId: string,
): T[] {
  return runs.filter((r) => r.noteId === noteId && r.id !== currentRunId)
}

export function promptForRun(
  note: Note,
  past: readonly Run[],
  to: AgentId,
  frames: (runId: string) => TranscriptFrame[],
  /**
   * The note arrived from another machine. The same agent there is no help:
   * its session is on that laptop, so this one starts fresh and needs the
   * briefing as much as a different agent would.
   */
  handedOver = false,
): string {
  // Nobody has been here, or the same agent is continuing its own work on
  // this machine — in which case its own session is a better memory than
  // anything we could write.
  const last = past.at(-1)
  if (!last || (last.agent === to && !handedOver)) return promptFor(note)

  try {
    const thread = buildThread(
      note,
      past.map((run) => ({ run, frames: frames(run.id) })),
    )
    // Nothing worth saying means nothing to say. A briefing that is only
    // headings is noise the next agent has to read past to reach the task.
    if (thread.arc.length === 0) return promptFor(note)
    return renderBriefing(thread, to)
  } catch {
    // A handoff that loses its briefing is a worse run. A handoff that throws
    // is no run at all — and the transcript is not important enough to be
    // allowed to stop work.
    return promptFor(note)
  }
}
