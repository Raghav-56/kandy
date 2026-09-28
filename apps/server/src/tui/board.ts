/**
 * The board screen as data: which rows exist, which one is selected, which
 * slice of them is on screen, and how each note summarises itself.
 *
 * Pure functions over a `BoardView`. Nothing here knows about Ink.
 */
import {
  AGENTS,
  AGENT_NAMES,
  notesIn,
  wasInterrupted,
  type AgentId,
  type AgentInfo,
  type BoardView,
  type Column,
  type Note,
  type Run,
  type RunnerInfo,
} from "@kandy/core"
import type { Tone } from "./theme.js"

export type Row =
  | { kind: "lane"; key: string; name: string; count: number }
  | { kind: "note"; key: string; note: Note }

function byPos(a: Column, b: Column): number {
  return a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1
}

/** Case-insensitive match on the things a person would type to find a note. */
export function matches(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [note.title, note.body, note.agent ?? "", note.branch ?? "", note.status]
    .join("\n")
    .toLowerCase()
    .includes(q)
}

/**
 * Lanes in board order, each followed by its notes. Empty lanes are left out,
 * as the web board leaves them out: a terminal has too few rows to spend
 * three of them saying "QUEUED 0", "RUNNING 0" — and the lane a note is in is
 * already on its row, as its glyph.
 */
export function boardRows(view: BoardView, filter = ""): Row[] {
  const rows: Row[] = []
  const placed = new Set<string>()
  for (const col of [...view.columns].sort(byPos)) {
    const notes = notesIn(view, col.id)
    for (const n of notes) placed.add(n.id)
    const shown = notes.filter((n) => matches(n, filter))
    if (shown.length === 0) continue
    rows.push({ kind: "lane", key: `lane:${col.id}`, name: col.name, count: shown.length })
    for (const note of shown) rows.push({ kind: "note", key: note.id, note })
  }
  // A note in a column this view doesn't have would otherwise vanish.
  const stray = view.notes.filter((n) => !placed.has(n.id) && matches(n, filter))
  if (stray.length > 0) {
    rows.push({ kind: "lane", key: "lane:?", name: "Other", count: stray.length })
    for (const note of stray) rows.push({ kind: "note", key: note.id, note })
  }
  return rows
}

function noteIndexes(rows: readonly Row[]): number[] {
  const out: number[] = []
  rows.forEach((r, i) => r.kind === "note" && out.push(i))
  return out
}

/**
 * Keep the selection on the same note across updates. If that note is gone
 * (deleted, filtered out), stay at the same position rather than jumping to
 * the top — the eye is already there.
 */
export function reconcileSelection(rows: readonly Row[], selectedId: string | null, lastIndex = 0): string | null {
  if (selectedId && rows.some((r) => r.kind === "note" && r.key === selectedId)) return selectedId
  const notes = noteIndexes(rows)
  if (notes.length === 0) return null
  const at = notes.find((i) => i >= lastIndex) ?? notes[notes.length - 1]!
  return rows[at]!.key
}

/** Move the selection by `delta` notes, clamped, skipping lane headers. */
export function moveSelection(rows: readonly Row[], selectedId: string | null, delta: number): string | null {
  const notes = noteIndexes(rows)
  if (notes.length === 0) return null
  const cur = notes.findIndex((i) => rows[i]!.key === selectedId)
  const from = cur === -1 ? (delta > 0 ? -1 : notes.length) : cur
  const next = Math.max(0, Math.min(notes.length - 1, from + delta))
  return rows[notes[next]!]!.key
}

export function selectFirst(rows: readonly Row[]): string | null {
  const i = noteIndexes(rows)[0]
  return i === undefined ? null : rows[i]!.key
}

export function selectLast(rows: readonly Row[]): string | null {
  const all = noteIndexes(rows)
  const i = all[all.length - 1]
  return i === undefined ? null : rows[i]!.key
}

export function rowIndex(rows: readonly Row[], id: string | null): number {
  return id === null ? -1 : rows.findIndex((r) => r.key === id)
}

/**
 * The first visible row, given the previous one: move only as far as needed
 * to keep `selected` on screen, and pull a lane header into view along with
 * the first note under it.
 */
export function scrollOffset(offset: number, selected: number, height: number, total: number): number {
  if (height <= 0) return 0
  let o = Math.max(0, Math.min(offset, Math.max(0, total - height)))
  if (selected < 0) return o
  // Show the header just above the selection when it is the lane's first note.
  const top = Math.max(0, selected - 1)
  if (top < o) o = top
  if (selected >= o + height) o = selected - height + 1
  return Math.max(0, Math.min(o, Math.max(0, total - height)))
}

// --- a note's summary ------------------------------------------------------

export function runOf(view: BoardView, note: Note): Run | undefined {
  return note.runId ? view.runs.find((r) => r.id === note.runId) : undefined
}

/**
 * Why a failed note stopped, in the three ways that ask different things of you.
 *
 * The model has one note status for all of them, `failed`. But a run the
 * daemon was stopped under was not the agent's doing — its worktree and
 * session are intact and it resumes — and one you cancelled is not a failure
 * at all. Saying "failed" for both, with no reason, sent people looking for a
 * bug that was not there. Derived from the run, so nothing new is stored.
 */
export type Failure = { kind: "interrupted" | "cancelled" | "failed"; reason: string | null }

export function failureOf(run: Pick<Run, "status" | "error"> | undefined | null): Failure {
  if (wasInterrupted(run)) return { kind: "interrupted", reason: "kandy stopped while this was running — it resumes where it left off" }
  if (run?.status === "cancelled") return { kind: "cancelled", reason: null }
  const first = run?.error?.split("\n").find((l) => l.trim())?.trim() ?? null
  return { kind: "failed", reason: first }
}

export function runsOf(view: BoardView, noteId: string): Run[] {
  return view.runs.filter((r) => r.noteId === noteId).sort((a, b) => a.startedAt - b.startedAt)
}

export function isLive(note: Note): boolean {
  return note.status === "running" || note.status === "queued" || note.status === "blocked"
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export type Glyph = { char: string; tone: Tone }

export function glyph(view: BoardView, note: Note, tick = 0): Glyph {
  if (view.prompts.some((p) => p.noteId === note.id)) return { char: "?", tone: "lemon" }
  if (note.held) return { char: "!", tone: "lemon" }
  switch (note.status) {
    case "blocked":
      return { char: "!", tone: "lemon" }
    case "running":
      return { char: SPINNER[tick % SPINNER.length]!, tone: "mint" }
    case "queued":
      return { char: "○", tone: "dim" }
    case "review":
      return { char: "●", tone: "mint" }
    case "done":
      return note.outcome === "discarded" ? { char: "–", tone: "dim" } : { char: "✓", tone: "dim" }
    case "failed": {
      const kind = failureOf(runOf(view, note)).kind
      if (kind === "interrupted") return { char: "↻", tone: "lemon" }
      if (kind === "cancelled") return { char: "✗", tone: "dim" }
      return { char: "✗", tone: "berry" }
    }
    case "draft":
      return { char: "·", tone: "dim" }
  }
}

/** "4s", "12m", "3h", "2d". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Elapsed for live work, how long ago for everything else. */
export function noteClock(view: BoardView, note: Note, now: number): string {
  const run = runOf(view, note)
  if (isLive(note) && run) return formatDuration(now - run.startedAt)
  return formatDuration(now - note.updatedAt)
}

export function agentLabel(agent: string | null | undefined): string {
  if (!agent) return ""
  return AGENT_NAMES[agent] ?? agent
}

export function diffstat(note: Note): string {
  if (!note.stat || (note.stat.insertions === 0 && note.stat.deletions === 0)) return ""
  return `+${note.stat.insertions} −${note.stat.deletions}`
}

/** Distinct notes waiting on a person: a question, a held run, a result to review, a refusal. */
export function needsYou(view: BoardView): number {
  const asked = new Set(view.prompts.map((p) => p.noteId))
  return view.notes.filter(
    // `!= null`, not `!== null`: a daemon older than the field sends no
    // `held` at all, and undefined is not a request anyone is waiting on.
    (n) => asked.has(n.id) || n.held != null || n.status === "review" || n.status === "blocked",
  ).length
}

export function runningCount(view: BoardView): number {
  return view.notes.filter((n) => n.status === "running").length
}

/** The machine name for a runner id, falling back to a shortened id. */
export function machineName(runners: readonly RunnerInfo[], runnerId: string | null): string | null {
  if (!runnerId) return null
  return runners.find((r) => r.runnerId === runnerId)?.name ?? runnerId.slice(0, 10)
}

// --- agents ----------------------------------------------------------------

/** Agents that could run now; everything we know of when the daemon can't say. */
export function readyAgents(infos: readonly AgentInfo[] | null): AgentId[] {
  if (!infos) return [...AGENTS]
  return infos.filter((a) => a.installed && a.authed).map((a) => a.id)
}

/** The agent a fresh note should run with: whatever ran last on this board, else the first ready one. */
export function defaultAgent(view: BoardView, ready: readonly AgentId[]): AgentId | null {
  const last = [...view.runs].sort((a, b) => b.startedAt - a.startedAt)[0]
  if (last && (ready.length === 0 || ready.includes(last.agent))) return last.agent
  return ready[0] ?? null
}

/** Where a new note goes: the inbox lane if the board has one, else its first column. */
export function inboxColumn(view: BoardView): string | null {
  const cols = [...view.columns].sort(byPos)
  return (cols.find((c) => c.lane === "inbox") ?? cols[0])?.id ?? null
}

// --- hub -------------------------------------------------------------------

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** A held note whose target machine belongs to the person at the keyboard. */
export function heldForMe(note: Note, runners: readonly RunnerInfo[], email: string | null): boolean {
  if (!note.held) return false
  const runner = runners.find((r) => r.runnerId === note.held!.runnerId)
  return sameEmail(runner?.owner, email)
}

/** Machines this note could be given to: online, carrying this board, not where it already is. */
export function giveTargets(runners: readonly RunnerInfo[], boardId: string, note: Note): RunnerInfo[] {
  return runners.filter((r) => r.online && r.boards.includes(boardId) && r.runnerId !== note.runner)
}
