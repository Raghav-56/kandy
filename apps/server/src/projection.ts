import { NO_ATTRIBUTION, reduce, type Board, type BoardView, type KandyEvent } from "@kandy/core"
import type { Store } from "./store.js"

/**
 * Live projections of every board, kept up to date incrementally.
 *
 * The first version replayed the whole log on every single request — and
 * `findBoardOf` replayed it once *per board* for every note action. That is
 * invisible at 500 events and ruinous at 500,000. Here the log is replayed
 * exactly once at startup; after that each appended event is folded into the
 * cached views, so a read is a map lookup.
 *
 * The log is still the only source of truth. These are derived, disposable,
 * and rebuilt from scratch on restart.
 */
export class Projections {
  private views = new Map<string, BoardView>()
  /** noteId -> boardId, so a note action doesn't have to search every board. */
  private noteHome = new Map<string, string>()

  constructor(store: Store) {
    for (const e of store.since(0, 1_000_000)) this.apply(e)
  }

  /** Fold one event into the cache. Called for every event as it is appended. */
  apply(e: KandyEvent): void {
    if (e.type === "board.created") {
      this.views.set(e.data.boardId, {
        board: {
          id: e.data.boardId,
          name: e.data.name,
          repoPath: e.data.repoPath,
          setup: e.data.setup ?? null,
          carry: e.data.carry ?? [],
          models: e.data.models ?? {},
          // Off unless a board.attribution event says otherwise — boards
          // created before this existed replay to silence, as they behaved.
          attribution: e.data.attribution ?? { ...NO_ATTRIBUTION },
          createdAt: e.ts,
        },
        columns: [],
        notes: [],
        runs: [],
        seq: e.seq,
      })
      return
    }

    if (e.type === "board.removed") {
      this.views.delete(e.data.boardId)
      for (const [noteId, boardId] of this.noteHome) {
        if (boardId === e.data.boardId) this.noteHome.delete(noteId)
      }
      return
    }

    // Route the event to the board it belongs to rather than reducing every
    // board against every event.
    const boardId = this.routeOf(e)
    if (boardId) {
      const view = this.views.get(boardId)
      if (view) this.views.set(boardId, reduce(view, e))
      if (e.type === "note.deleted") this.noteHome.delete(e.data.noteId)
      return
    }

    // Unroutable events (an unknown note id, say) are dropped rather than
    // broadcast — a stray event must not corrupt a board it has nothing to do
    // with.
  }

  private routeOf(e: KandyEvent): string | undefined {
    const d = e.data as Record<string, unknown>

    if (typeof d["boardId"] === "string") {
      // note.created is where a note first learns which board it lives on.
      if (typeof d["noteId"] === "string") this.noteHome.set(d["noteId"], d["boardId"])
      return d["boardId"]
    }
    if (typeof d["noteId"] === "string") return this.noteHome.get(d["noteId"])
    if (typeof d["runId"] === "string") {
      // Run events carry no noteId once started; find the run's note.
      for (const [boardId, view] of this.views) {
        if (view.runs.some((r) => r.id === d["runId"])) return boardId
      }
    }
    if (typeof d["columnId"] === "string") {
      for (const [boardId, view] of this.views) {
        if (view.columns.some((c) => c.id === d["columnId"])) return boardId
      }
    }
    return undefined
  }

  view(boardId: string): BoardView | null {
    return this.views.get(boardId) ?? null
  }

  /** Which board a note lives on. O(1). */
  boardOf(noteId: string): BoardView | null {
    const boardId = this.noteHome.get(noteId)
    return boardId ? (this.views.get(boardId) ?? null) : null
  }

  boards(): Board[] {
    return [...this.views.values()]
      .map((v) => v.board)
      .sort((a, b) => a.createdAt - b.createdAt)
  }
}
