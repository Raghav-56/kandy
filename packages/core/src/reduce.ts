import {
  LANE_OF,
  type BoardView,
  type Column,
  type CostSource,
  type DiffStat,
  type Note,
  type NoteStatus,
  type Run,
} from "./domain.js"
import type { KandyEvent } from "./events.js"
import { kindOf, type PermissionPrompt, type PermissionRule } from "./permission.js"

/**
 * The single implementation of "what does this event do to the board".
 * The server projects with it, the web client reduces with it, and the TUI
 * reduces with it. There is deliberately no second copy anywhere.
 *
 * Immutable — returns a new view, or the same reference when nothing applies,
 * so React can bail out of rendering cheaply.
 */
export function reduce(view: BoardView, e: KandyEvent): BoardView {
  const next = apply(view, e)
  // Sequence advances even for events this board ignores, so a client never
  // re-requests a range it has already seen.
  return next === view ? { ...view, seq: e.seq } : { ...next, seq: e.seq }
}

export function reduceAll(view: BoardView, events: readonly KandyEvent[]): BoardView {
  return events.reduce(reduce, view)
}

function apply(view: BoardView, e: KandyEvent): BoardView {
  switch (e.type) {
    case "board.created":
    // Removal is handled where boards are held, not inside one board's view.
    case "board.removed":
      return view

    case "board.models": {
      if (e.data.boardId !== view.board.id) return view
      return { ...view, board: { ...view.board, models: e.data.models } }
    }

    case "board.policy": {
      if (e.data.boardId !== view.board.id) return view
      return { ...view, board: { ...view.board, defaultPolicy: e.data.defaultPolicy } }
    }

    case "board.attribution": {
      if (e.data.boardId !== view.board.id) return view
      return { ...view, board: { ...view.board, attribution: e.data.attribution } }
    }

    case "board.setup": {
      if (e.data.boardId !== view.board.id) return view
      return {
        ...view,
        board: { ...view.board, setup: e.data.setup, carry: e.data.carry ?? view.board.carry },
      }
    }

    case "column.created": {
      if (e.data.boardId !== view.board.id) return view
      const { columnId, boardId, name, pos, lane } = e.data
      return {
        ...view,
        columns: [...view.columns, { id: columnId, boardId, name, pos, lane: lane ?? null }],
      }
    }

    case "note.created": {
      if (e.data.boardId !== view.board.id) return view
      const note: Note = {
        id: e.data.noteId,
        boardId: e.data.boardId,
        columnId: e.data.columnId,
        title: e.data.title,
        body: e.data.body,
        status: "draft",
        pos: e.data.pos,
        agent: null,
        model: null,
        // The board's default at the moment the note was written. Read from
        // the view rather than stamped into the event, so replay gives the
        // same answer: `board.policy` events are ordered against this one.
        policy: view.board.defaultPolicy ?? "repo",
        rules: [],
        runId: null,
        branch: null,
        worktree: null,
        stat: null,
        pr: null,
        outcome: null,
        createdAt: e.ts,
        updatedAt: e.ts,
      }
      return { ...view, notes: [...view.notes, note] }
    }

    case "note.edited":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({
        ...n,
        title: e.data.title ?? n.title,
        body: e.data.body ?? n.body,
      }))

    case "note.moved":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({
        ...n,
        columnId: e.data.columnId,
        pos: e.data.pos,
      }))

    case "note.assigned":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({ ...n, agent: e.data.agent }))

    case "note.pr":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({ ...n, pr: e.data.pr }))

    case "note.model":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({ ...n, model: e.data.model }))

    case "note.policy":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({ ...n, policy: e.data.policy }))

    case "note.permission": {
      const rule = e.data.rule
      return patchNote(view, e.data.noteId, e.ts, (n) => ({
        ...n,
        // The same rule twice is the same rule. Replayed logs and a
        // double-clicked button both produce it, and neither should make the
        // list of standing answers grow forever.
        rules: n.rules.some((r) => same(r, rule)) ? n.rules : [...n.rules, rule],
      }))
    }

    case "note.status":
      return patchNote(view, e.data.noteId, e.ts, (n) => ({ ...n, status: e.data.status }))

    case "note.deleted": {
      if (!view.notes.some((n) => n.id === e.data.noteId)) return view
      const gone = { ...view, notes: view.notes.filter((n) => n.id !== e.data.noteId) }
      return without(gone, (p) => p.noteId === e.data.noteId)
    }

    case "run.requested": {
      if (!view.notes.some((n) => n.id === e.data.noteId)) return view
      const run: Run = {
        id: e.data.runId,
        noteId: e.data.noteId,
        agent: e.data.agent,
        agentSessionId: null,
        status: "starting",
        baseRef: null,
        startedAt: e.ts,
        endedAt: null,
        exitCode: null,
        error: null,
        costUsd: null,
        tokens: null,
        turns: null,
        model: null,
        costSource: "unpriced",
      }
      const withRun = { ...view, runs: [...view.runs, run] }
      return patchNote(withRun, e.data.noteId, e.ts, (n) => ({
        ...n,
        status: "queued",
        agent: e.data.agent,
        runId: run.id,
      }))
    }

    case "run.started": {
      const withRun = patchRun(view, e.data.runId, (r) => ({
        ...r,
        status: "running",
        baseRef: e.data.baseRef,
      }))
      return patchNote(withRun, e.data.noteId, e.ts, (n) => ({
        ...n,
        status: "running",
        branch: e.data.branch,
        worktree: e.data.worktree,
      }))
    }

    case "run.metrics":
      return patchRun(view, e.data.runId, (r) => ({
        ...r,
        // Costs accumulate across turns of the same run.
        costUsd: sum(r.costUsd, e.data.costUsd),
        tokens: sum(r.tokens, e.data.tokens),
        // Summed, not replaced. Claude reports a cumulative num_turns once per
        // result; Codex reports turns:1 on every turn.completed. Summing is
        // right for both — replacing made every Codex run read "1 turn" no
        // matter how long it worked.
        turns: sum(r.turns, e.data.turns),
        model: e.data.model ?? r.model,
        // A run that was ever estimated stays estimated: mixing a reported
        // figure with a computed one and calling the total exact would be the
        // dishonest half of both.
        costSource: worst(r.costSource, e.data.source ?? "unpriced"),
      }))

    case "run.session":
      return patchRun(view, e.data.runId, (r) => ({
        ...r,
        agentSessionId: e.data.agentSessionId,
      }))

    case "run.blocked": {
      const withRun = patchRun(view, e.data.runId, (r) => ({ ...r, status: "blocked" }))
      const blocked = patchRunNote(withRun, e.data.runId, e.ts, (n) => ({
        ...n,
        status: "blocked",
      }))
      // Without `ask` this is the old shape: a refusal the agent has already
      // walked away from. Nothing is waiting, so nothing goes on the list.
      if (!e.data.ask) return blocked

      const run = blocked.runs.find((r) => r.id === e.data.runId)
      if (!run) return blocked
      if (blocked.prompts.some((p) => p.requestId === e.data.requestId)) return blocked

      const tool = e.data.tool ?? "tool"
      const command = e.data.command ?? e.data.detail
      const prompt: PermissionPrompt = {
        requestId: e.data.requestId,
        runId: e.data.runId,
        noteId: run.noteId,
        tool,
        command,
        rule: kindOf({ tool, command }),
        askedAt: e.ts,
      }
      return { ...blocked, prompts: [...blocked.prompts, prompt] }
    }

    case "run.unblocked": {
      const withRun = patchRun(view, e.data.runId, (r) => ({ ...r, status: "running" }))
      const running = patchRunNote(withRun, e.data.runId, e.ts, (n) => ({
        ...n,
        status: "running",
      }))
      return without(running, (p) => p.requestId === e.data.requestId)
    }

    case "run.finished": {
      const withRun = patchRun(view, e.data.runId, (r) => ({
        ...r,
        status: e.data.status,
        endedAt: e.ts,
        exitCode: e.data.exitCode,
        error: e.data.error,
      }))
      // A successful run lands in review, not done. A human decides done.
      const status = e.data.status === "succeeded" ? "review" : "failed"
      const finished = patchNote(withRun, e.data.noteId, e.ts, (n) => ({ ...n, status }))
      // The process this question was asked on behalf of is gone. Leaving the
      // prompt up would offer an answer that can no longer reach anything.
      return without(finished, (p) => p.runId === e.data.runId)
    }

    case "review.decided": {
      const revise = e.data.decision === "revise"
      return patchNote(view, e.data.noteId, e.ts, (n) => ({
        ...n,
        status: revise ? "draft" : "done",
        outcome: revise ? null : e.data.decision === "merge" ? "merged" : "discarded",
      }))
    }

    case "review.opened":
      // Early events stored the stat as git's own printed summary. Normalise
      // rather than migrate: the log is immutable, so readers absorb history.
      return patchNote(view, e.data.noteId, e.ts, (n) => ({
        ...n,
        stat: asDiffStat(e.data.stat),
      }))

    // Transcript volume is not board state; clients fetch it per note.
    case "run.output":
    case "run.tool":
      return view
  }
}

/** Drop the prompts a change has just made unanswerable. */
function without(view: BoardView, gone: (p: PermissionPrompt) => boolean): BoardView {
  const prompts = view.prompts.filter((p) => !gone(p))
  return prompts.length === view.prompts.length ? view : { ...view, prompts }
}

function same(a: PermissionRule, b: PermissionRule): boolean {
  return a.tool === b.tool && a.pattern === b.pattern && a.decision === b.decision
}

/**
 * Questions waiting on this note, newest last.
 *
 * There is normally exactly one — an agent asks and then stops — but a run
 * that made two tool calls in a turn can have two, and showing only the first
 * would leave the second waiting silently.
 */
export function promptsFor(view: BoardView, noteId: string): PermissionPrompt[] {
  return view.prompts.filter((p) => p.noteId === noteId)
}

function asDiffStat(v: unknown): DiffStat | null {
  if (v && typeof v === "object" && "insertions" in v) return v as DiffStat
  return null
}

const CONFIDENCE: Record<CostSource, number> = { reported: 0, estimated: 1, unpriced: 2 }

function worst(a: CostSource, b: CostSource): CostSource {
  // "unpriced" only wins when nothing priced it at all.
  if (a === "unpriced") return b
  if (b === "unpriced") return a
  return CONFIDENCE[a] >= CONFIDENCE[b] ? a : b
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return a + b
}

function patchNote(
  view: BoardView,
  noteId: string,
  ts: number,
  fn: (n: Note) => Note,
): BoardView {
  let hit = false
  const notes = view.notes.map((n) => {
    if (n.id !== noteId) return n
    hit = true
    return { ...fn(n), updatedAt: ts }
  })
  return hit ? { ...view, notes } : view
}

function patchRun(view: BoardView, runId: string, fn: (r: Run) => Run): BoardView {
  let hit = false
  const runs = view.runs.map((r) => {
    if (r.id !== runId) return r
    hit = true
    return fn(r)
  })
  return hit ? { ...view, runs } : view
}

function patchRunNote(
  view: BoardView,
  runId: string,
  ts: number,
  fn: (n: Note) => Note,
): BoardView {
  const run = view.runs.find((r) => r.id === runId)
  return run ? patchNote(view, run.noteId, ts, fn) : view
}

/** The column a note belongs in, given its status. Undefined if the board has none. */
export function laneColumn(view: BoardView, status: NoteStatus): Column | undefined {
  const lane = LANE_OF[status]
  return (
    view.columns.find((c) => c.lane === lane) ??
    // Boards created before columns declared lanes still have the default
    // names. Matching on those keeps them working instead of silently doing
    // nothing on every status change.
    view.columns.find((c) => c.lane === null && c.name.toLowerCase() === lane)
  )
}

/** Notes in a column, in board order. */
export function notesIn(view: BoardView, columnId: string): Note[] {
  return view.notes
    .filter((n) => n.columnId === columnId)
    .sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1))
}
