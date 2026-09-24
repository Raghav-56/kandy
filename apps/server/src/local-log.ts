import type {
  ActorId,
  BoardView,
  Log,
  PendingEvent,
  TranscriptFrame,
  TranscriptRole,
} from "@kandy/core"
import type { Engine } from "./engine.js"

/**
 * The log a runner sharing a process with its hub talks to.
 *
 * Thin on purpose — every method is the `Engine` call the runner used to make
 * directly. It exists so that `kandy serve`, which is both halves in one
 * process, goes through the same interface a remote runner will, rather than
 * keeping a shortcut that would let the two drift apart.
 *
 * The actor is fixed at construction rather than passed per call, because on a
 * single-player daemon it is the same person every time and there is nobody to
 * distinguish them from. A hub, which hears from several machines, reads it off
 * each connection instead.
 */
export class LocalLog implements Log {
  constructor(
    private readonly engine: Engine,
    private readonly actor: ActorId | null = null,
  ) {}

  emit(pending: PendingEvent): void {
    this.engine.emit(pending, this.actor)
  }

  say(runId: string, role: TranscriptRole, text: string, meta?: string): void {
    this.engine.say(runId, role, text, meta)
  }

  activity(runId: string, tool: string, detail: string): void {
    this.engine.activity(runId, tool, detail)
  }

  output(runId: string, channel: "stdout" | "stderr", text: string): void {
    this.engine.store.appendOutput(runId, channel, text)
  }

  saveDiff(
    noteId: string,
    snapshot: { runId: string; branch: string; stat: string; diff: string },
  ): void {
    this.engine.store.saveDiff(noteId, snapshot)
  }

  view(boardId: string): BoardView | null {
    return this.engine.view(boardId)
  }

  /**
   * Already in hand, but promised anyway.
   *
   * The interface is async because a remote runner reads transcripts it has
   * never held — a note handed over by a teammate. Resolving immediately here
   * costs a microtask and keeps one shape for both.
   */
  history(runId: string): Promise<TranscriptFrame[]> {
    return Promise.resolve(this.engine.store.transcriptSince(runId, 0, 5000))
  }
}
