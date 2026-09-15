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
export function promptForRun(
  note: Note,
  past: readonly Run[],
  to: AgentId,
  frames: (runId: string) => TranscriptFrame[],
): string {
  // Nobody has been here, or the same agent is continuing its own work — in
  // which case its own session is a better memory than anything we could write.
  const last = past.at(-1)
  if (!last || last.agent === to) return promptFor(note)

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
