/**
 * The team's activity, as sentences: "alice merged «Fix the flash»".
 *
 * Shared by the web board's Team page and the terminal's, so the two can't
 * describe the same event differently.
 */
import type { BoardView } from "./domain.js"
import type { KandyEvent } from "./events.js"
import type { RunnerInfo } from "./protocol.js"
import { AGENT_NAMES } from "./thread.js"

function agentName(agent: string | null | undefined): string {
  return agent ? (AGENT_NAMES[agent] ?? agent) : "an agent"
}

export type ActivityCtx = {
  title: (noteId: string) => string
  column: (columnId: string) => string
  runner: (runnerId: string) => string
  noteOfRun: (runId: string) => string | null
}

/**
 * One event as the rest of a sentence whose subject is the actor.
 *
 * Only the events people do on purpose are phrased. Anything else falls back
 * to its type — ugly but true, which beats a list that quietly omits what it
 * cannot describe.
 */
export function activityPhrase(e: KandyEvent, c: ActivityCtx): string {
  switch (e.type) {
    case "note.created":
      return `wrote ${c.title(e.data.noteId)}`
    case "note.edited":
      return `edited ${c.title(e.data.noteId)}`
    case "note.moved":
      return `moved ${c.title(e.data.noteId)} to ${c.column(e.data.columnId)}`
    case "note.assigned":
      return `gave ${c.title(e.data.noteId)} to ${agentName(e.data.agent)}`
    case "note.deleted":
      return `deleted ${c.title(e.data.noteId)}`
    case "note.policy":
      return `set ${c.title(e.data.noteId)} to ${e.data.policy === "full" ? "full access" : "repo only"}`
    case "note.held":
      return `asked to run ${c.title(e.data.noteId)} on ${c.runner(e.data.runnerId)}`
    case "note.placed":
      return `gave ${c.title(e.data.noteId)} to ${c.runner(e.data.runnerId)}`
    case "note.handed":
      return `handed ${c.title(e.data.noteId)} on to ${c.runner(e.data.to)}`
    case "note.released":
      return `${e.data.accepted ? "allowed" : "declined"} ${c.title(e.data.noteId)}`
    case "note.pr":
      return e.data.pr ? `opened a PR for ${c.title(e.data.noteId)}` : `updated the PR for ${c.title(e.data.noteId)}`
    case "run.requested":
      return `ran ${c.title(e.data.noteId)} with ${agentName(e.data.agent)}`
    case "run.unblocked": {
      const noteId = c.noteOfRun(e.data.runId)
      const what = e.data.decision === "allow" ? "allowed" : "denied"
      return noteId ? `${what} a request on ${c.title(noteId)}` : `${what} an agent's request`
    }
    case "review.decided": {
      const verb = { merge: "merged", discard: "discarded", revise: "sent back" }[e.data.decision]
      return `${verb} ${c.title(e.data.noteId)}`
    }
    case "member.added":
      return `added ${e.data.email} as ${e.data.role}`
    case "member.role":
      return `made ${e.data.email} ${e.data.role === "owner" ? "an" : "a"} ${e.data.role}`
    case "member.removed":
      return `removed ${e.data.email}`
    case "board.created":
      return `added the repo ${e.data.name}`
    default:
      return e.type
  }
}

/**
 * What `activityPhrase` needs to name things, from what a client has.
 *
 * Titles come from the board, then from the events themselves — a note deleted
 * since is gone from the view, but the event that created it still knows what
 * it was called.
 */
export function activityContext(events: readonly KandyEvent[], view: BoardView | null, runners: readonly RunnerInfo[]): ActivityCtx {
  const titles = new Map<string, string>()
  for (const e of [...events].reverse()) {
    if (e.type === "note.created") titles.set(e.data.noteId, e.data.title)
    if (e.type === "note.edited" && e.data.title) titles.set(e.data.noteId, e.data.title)
  }
  for (const n of view?.notes ?? []) titles.set(n.id, n.title)
  return {
    title: (id) => `«${titles.get(id) ?? "a note"}»`,
    column: (id) => view?.columns.find((c) => c.id === id)?.name ?? "another column",
    runner: (id) => runners.find((r) => r.runnerId === id)?.name ?? "a machine",
    noteOfRun: (runId) => view?.runs.find((r) => r.id === runId)?.noteId ?? null,
  }
}

/**
 * Whether an event belongs in a list of what people did. Adding a repo makes
 * its five lifecycle columns as five events; listed, they bury the one line
 * that says what happened — "added the repo".
 */
export function isTeamActivity(e: KandyEvent): boolean {
  return e.type !== "column.created"
}

/**
 * Who a line is about. Usually whoever caused the event — but a hold is
 * written by the machine that received the request, on behalf of the person
 * who made it, so "alice asked to run Bob's note" has to read "bob asked".
 */
export function activityActor(e: KandyEvent): string | null {
  if (e.type === "note.held" && e.data.requestedBy) return e.data.requestedBy
  return e.actor
}
