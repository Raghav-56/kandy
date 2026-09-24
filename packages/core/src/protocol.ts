import type { AgentInfo } from "./api.js"
import type { BoardId, NoteId, RunId } from "./id.js"
import type { PendingEvent, TranscriptRole } from "./events.js"

/**
 * The runner protocol: how a machine that runs agents talks to a hub.
 *
 * Published, versioned, and tested by conformance rather than by agreement
 * with ourselves. opencode's lesson is that a protocol is what lets other
 * people build on a thing; kandy's is narrower — a kandy *frontend* ecosystem
 * is a weak bet, but a *runner* is where others can add what we never will: a
 * runner on a CI box, in a sandbox, or for an agent we do not support.
 *
 * ## Shape
 *
 * The runner always dials out. Nothing on a person's laptop listens, so there
 * is no port to open, no tunnel to run and no firewall exception to ask for.
 *
 *     runner                                     hub
 *       │  POST /runner/hello     Hello  ──────▶  │  who I am, what I can run
 *       │  GET  /runner/stream    ◀──── SSE ────  │  events, and commands for me
 *       │  POST /runner/log       LogBatch ────▶  │  what my runs did
 *       │  POST /runner/reply     Reply ───────▶  │  answers to commands
 *       │  GET  /runs/:id/transcript  ◀────────── │  history, for a handoff
 *
 * HTTP and server-sent events rather than a WebSocket, deliberately: every
 * kandy client already speaks both, they pass unchanged through `tailscale
 * serve` and ordinary proxies, and they need no dependency. Holding the stream
 * open is also what "online" means — the hub needs no heartbeat to know.
 *
 * ## What the hub will and will not do
 *
 * It stamps `seq` and `actor` on everything a runner appends — the actor from
 * the authenticated connection, never from the message. It accepts a runner's
 * writes only for notes placed on that runner. It never spawns an agent,
 * never holds a provider key, never touches a repository. Everything that
 * needs a repository is a command it sends to the runner that holds one.
 */

/**
 * Bumped when a change would break a runner written against the last one.
 * A hub refuses a hello from a different major version rather than guessing,
 * because a runner that misreads a command is worse than one that is told to
 * upgrade.
 */
export const RUNNER_PROTOCOL = 1

export type RunnerId = string

/** The first thing a runner says, and the only way it becomes known. */
export type Hello = {
  protocol: number
  /** Stable per machine, kept in the runner's own state directory. */
  runnerId: RunnerId
  /** What a person would call this machine: its hostname. */
  name: string
  os: string
  /** Agents installed and signed in here — what this runner can be asked to run. */
  agents: AgentInfo[]
  /**
   * Boards whose repositories this machine has checked out, by board id.
   *
   * A runner cannot be asked to work on a repository it does not have. Git
   * decides who may clone what; this only says what already is.
   */
  boards: BoardId[]
}

export type HelloReply = {
  ok: true
  protocol: number
  /** Who the hub believes this runner belongs to. Null on a single-player hub. */
  owner: string | null
}

/**
 * One write to the log, as a runner sends it.
 *
 * The same seven operations as the `Log` interface, minus the two reads: a
 * runner keeps its own replica for `view`, and asks for `history` over the
 * ordinary transcript route.
 */
export type LogOp =
  | { op: "emit"; pending: PendingEvent }
  | { op: "say"; runId: RunId; role: TranscriptRole; text: string; meta?: string }
  | { op: "activity"; runId: RunId; tool: string; detail: string }
  | { op: "output"; runId: RunId; channel: "stdout" | "stderr"; text: string }
  | {
      op: "saveDiff"
      noteId: NoteId
      snapshot: { runId: RunId; branch: string; stat: string; diff: string }
    }

/**
 * Writes travel in batches, in order.
 *
 * An agent can print hundreds of lines a second, and one HTTP request per
 * line would make the transport the bottleneck. Order within and across
 * batches is preserved, because a transcript out of order is a different
 * transcript.
 */
export type LogBatch = { runnerId: RunnerId; ops: LogOp[] }

/**
 * Something the hub needs done on the machine that holds the repository.
 *
 * `op` names a method of the runner's workshop and `args` are its arguments,
 * all plain data. The runner answers every command exactly once, by id.
 */
export type Command = { id: string; op: string; args: unknown[] }

export type Reply =
  | { runnerId: RunnerId; id: string; ok: true; result: unknown }
  | { runnerId: RunnerId; id: string; ok: false; error: string; status?: number }

/** What the hub shows about a runner: the admin page, and where a note is running. */
export type RunnerInfo = {
  runnerId: RunnerId
  name: string
  os: string
  owner: string | null
  agents: AgentInfo[]
  boards: BoardId[]
  online: boolean
  lastSeen: number
}

/** The SSE event name commands arrive under, beside the ordinary domain events. */
export const COMMAND_EVENT = "command"

/**
 * The note a runner's write is about, for the hub to check it may write it.
 *
 * Every event a runner has reason to append names a note or a run. One that
 * names neither is not a runner's business — boards and columns are changed
 * by people, through the API — so the answer is null and the hub refuses it.
 */
export function subjectOf(
  pending: PendingEvent,
  noteOfRun: (runId: string) => string | null,
): string | null {
  const data = pending.data as { noteId?: unknown; runId?: unknown }
  if (typeof data.noteId === "string") return data.noteId
  if (typeof data.runId === "string") return noteOfRun(data.runId)
  return null
}
