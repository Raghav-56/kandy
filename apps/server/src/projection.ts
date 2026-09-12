import { reduceAll, type BoardView, type KandyEvent } from "@kandy/core"
import type { Store } from "./store.js"

/**
 * Rebuild a board view by replaying the log.
 *
 * Replay-from-zero is correct and fast enough for a long time — these are
 * thousands of small rows, not millions, and output volume lives elsewhere.
 * When it stops being fast enough the fix is a periodic snapshot row, not a
 * mutable read model; keep the log authoritative.
 */
export function projectBoard(store: Store, boardId: string): BoardView | null {
  const events = store.since(0, 1_000_000)
  const created = events.find(
    (e): e is KandyEvent<"board.created"> =>
      e.type === "board.created" && e.data.boardId === boardId,
  )
  if (!created) return null

  const empty: BoardView = {
    board: {
      id: created.data.boardId,
      name: created.data.name,
      repoPath: created.data.repoPath,
      createdAt: created.ts,
    },
    columns: [],
    notes: [],
    runs: [],
    seq: created.seq,
  }
  return reduceAll(empty, events)
}

export function listBoards(store: Store) {
  return store
    .since(0, 1_000_000)
    .filter((e): e is KandyEvent<"board.created"> => e.type === "board.created")
    .map((e) => ({
      id: e.data.boardId,
      name: e.data.name,
      repoPath: e.data.repoPath,
      createdAt: e.ts,
    }))
}
