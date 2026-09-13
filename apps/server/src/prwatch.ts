import { event } from "@kandy/core"
import type { Engine } from "./engine.js"
import { prForBranch } from "./forge.js"

/**
 * Keeps PR state fresh.
 *
 * A PR changes on the forge, not here — CI goes green, someone approves it,
 * someone merges it — and a board that shows a stale "pending" forever is
 * worse than showing nothing. Polls only notes that actually have an open PR,
 * so a board with none costs nothing.
 */
export class PrWatch {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private engine: Engine,
    private everyMs = 60_000,
    /** Called when a PR merge lands a note, so its lane and worktree follow. */
    private onLanded?: (boardId: string, noteId: string) => void,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep(), this.everyMs)
    // Don't hold the process open just to poll GitHub.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Refresh one note now, e.g. right after the user acted on it. */
  async refresh(boardId: string, noteId: string): Promise<void> {
    const view = this.engine.view(boardId)
    const note = view?.notes.find((n) => n.id === noteId)
    if (!view || !note?.branch) return

    const pr = await prForBranch(view.board.repoPath, note.branch)
    if (!same(note.pr, pr)) this.engine.emit(event("note.pr", { noteId, pr }))
  }

  private async sweep(): Promise<void> {
    for (const board of this.engine.projections.boards()) {
      const view = this.engine.view(board.id)
      if (!view) continue

      const watched = view.notes.filter((n) => n.branch && n.pr && n.pr.state === "open")
      for (const note of watched) {
        try {
          const pr = await prForBranch(view.board.repoPath, note.branch!)
          if (!same(note.pr, pr)) {
            this.engine.emit(event("note.pr", { noteId: note.id, pr }))

            // A PR merged on the forge is the note landing. Leaving it in
            // review means the board disagrees with GitHub about finished work.
            if (pr?.state === "merged" && note.status === "review") {
              this.engine.emit(
                event("review.decided", { noteId: note.id, decision: "merge", comment: "merged via pull request" }),
              )
              this.onLanded?.(view.board.id, note.id)
            }
          }
        } catch {
          // A forge that is down is not a reason to stop watching the rest.
        }
      }
    }
  }
}

/** Only emit when something a person would notice actually changed. */
function same(a: { state?: string; checks?: unknown; review?: unknown; draft?: boolean } | null, b: typeof a): boolean {
  if (a === null || b === null) return a === b
  return (
    a.state === b.state &&
    a.checks === b.checks &&
    a.review === b.review &&
    a.draft === b.draft
  )
}
