import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import {
  between,
  event,
  id,
  notesIn,
  type AgentId,
  type BoardView,
  type ErrorCode,
} from "@kandy/core"
import type { Store } from "./store.js"
import type { Bus } from "./bus.js"
import type { Runner } from "./runner.js"
import { listBoards, projectBoard } from "./projection.js"
import { detectAll } from "./agents/index.js"
import { isDirty } from "./worktree.js"

const VERSION = "0.0.0"
const STARTED = Date.now()

export type ServerDeps = { store: Store; bus: Bus; runner: Runner }

export function createHttpServer(deps: ServerDeps) {
  return createServer((req, res) => {
    void handle(deps, req, res).catch((err) => {
      console.error("[http]", err)
      send(res, 500, { ok: false, error: { code: "internal", message: String(err) } })
    })
  })
}

async function handle(deps: ServerDeps, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost")
  const parts = url.pathname.split("/").filter(Boolean)

  // The web client is served from a different origin in dev.
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization")
  if (req.method === "OPTIONS") return void res.writeHead(204).end()

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { version: VERSION, uptime: Date.now() - STARTED, pid: process.pid })
  }

  if (req.method === "GET" && url.pathname === "/events") {
    return sse(deps, req, res, Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0))
  }

  if (req.method === "GET" && url.pathname === "/agents") {
    return send(res, 200, { agents: await detectAll() })
  }

  if (req.method === "GET" && url.pathname === "/boards") {
    return send(res, 200, { boards: listBoards(deps.store) })
  }

  if (req.method === "POST" && url.pathname === "/boards") {
    const body = await json<{ name: string; repoPath: string }>(req)
    if (!body?.name || !body?.repoPath) return fail(res, 400, "bad_request", "name and repoPath required")

    const boardId = id("board")
    emit(deps, event("board.created", { boardId, name: body.name, repoPath: body.repoPath }))
    // Seed the lifecycle lanes. They're labels; status on the note is authoritative.
    for (const [i, name] of ["Inbox", "Queued", "Running", "Review", "Done"].entries()) {
      emit(
        deps,
        event("column.created", {
          columnId: id("col"),
          boardId,
          name,
          pos: between(null, null) + String(i),
        }),
      )
    }
    const view = projectBoard(deps.store, boardId)!
    return send(res, 200, { ok: true, seq: view.seq, board: view.board })
  }

  // GET /boards/:id/view
  if (req.method === "GET" && parts[0] === "boards" && parts[2] === "view") {
    const view = projectBoard(deps.store, parts[1]!)
    if (!view) return fail(res, 404, "board_not_found", `no board ${parts[1]}`)
    return send(res, 200, view)
  }

  if (req.method === "POST" && url.pathname === "/notes") {
    const body = await json<{ boardId: string; columnId: string; title: string; body?: string }>(req)
    if (!body?.boardId || !body?.columnId || !body?.title)
      return fail(res, 400, "bad_request", "boardId, columnId and title required")

    const view = projectBoard(deps.store, body.boardId)
    if (!view) return fail(res, 404, "board_not_found", `no board ${body.boardId}`)

    const last = notesIn(view, body.columnId).at(-1)
    const noteId = id("note")
    const e = emit(
      deps,
      event("note.created", {
        noteId,
        boardId: body.boardId,
        columnId: body.columnId,
        title: body.title,
        body: body.body ?? "",
        pos: between(last?.pos ?? null, null),
      }),
    )
    return send(res, 200, { ok: true, seq: e.seq, noteId })
  }

  // POST /notes/:id/<action>
  if (req.method === "POST" && parts[0] === "notes" && parts[1]) {
    return noteAction(deps, res, parts[1], parts[2] ?? "", req)
  }

  // POST /runs/:id/cancel
  if (req.method === "POST" && parts[0] === "runs" && parts[2] === "cancel") {
    return send(res, 200, { ok: true, seq: deps.store.head(), cancelled: deps.runner.cancel(parts[1]!) })
  }

  // GET /runs/:id/output
  if (req.method === "GET" && parts[0] === "runs" && parts[2] === "output") {
    const after = Number(url.searchParams.get("after") ?? 0)
    const lines = deps.store.outputSince(parts[1]!, after)
    return send(res, 200, { lines, nextAfter: lines.at(-1)?.seq ?? null })
  }

  return fail(res, 404, "bad_request", `no route for ${req.method} ${url.pathname}`)
}

async function noteAction(
  deps: ServerDeps,
  res: ServerResponse,
  noteId: string,
  action: string,
  req: IncomingMessage,
) {
  const view = findBoardOf(deps.store, noteId)
  if (!view) return fail(res, 404, "note_not_found", `no note ${noteId}`)
  const note = view.notes.find((n) => n.id === noteId)!

  switch (action) {
    case "edit": {
      const b = await json<{ title?: string; body?: string }>(req)
      const e = emit(deps, event("note.edited", { noteId, ...b }))
      return send(res, 200, { ok: true, seq: e.seq })
    }
    case "move": {
      const b = await json<{ columnId: string; before?: string; after?: string }>(req)
      if (!b?.columnId) return fail(res, 400, "bad_request", "columnId required")
      // Positions come from neighbour ids, not raw keys — the client says
      // "between these two", the server computes the key. One source of truth.
      const siblings = notesIn(view, b.columnId).filter((n) => n.id !== noteId)
      const afterPos = b.after ? (siblings.find((n) => n.id === b.after)?.pos ?? null) : null
      const beforePos = b.before ? (siblings.find((n) => n.id === b.before)?.pos ?? null) : null
      const e = emit(
        deps,
        event("note.moved", { noteId, columnId: b.columnId, pos: between(afterPos, beforePos) }),
      )
      return send(res, 200, { ok: true, seq: e.seq })
    }
    case "assign": {
      const b = await json<{ agent: AgentId }>(req)
      if (!b?.agent) return fail(res, 400, "bad_request", "agent required")
      const e = emit(deps, event("note.assigned", { noteId, agent: b.agent }))
      return send(res, 200, { ok: true, seq: e.seq })
    }
    case "delete": {
      const e = emit(deps, event("note.deleted", { noteId }))
      return send(res, 200, { ok: true, seq: e.seq })
    }
    case "run": {
      const b = await json<{ agent?: AgentId }>(req)
      const agent = b?.agent ?? note.agent
      if (!agent) return fail(res, 400, "bad_request", "note has no agent assigned")
      if (note.status === "running" || note.status === "queued")
        return fail(res, 409, "invalid_transition", `note is already ${note.status}`)

      // Surface a dirty tree rather than silently branching from HEAD and
      // giving the agent a repo that's missing the user's last hour of work.
      if (await isDirty(view.board.repoPath)) {
        return fail(res, 409, "repo_dirty", "repo has uncommitted changes; commit or stash first")
      }

      const runId = deps.runner.request(view.board.id, noteId, agent)
      return send(res, 200, { ok: true, seq: deps.store.head(), runId })
    }
    case "review": {
      const b = await json<{ decision: "merge" | "discard" | "revise"; comment?: string }>(req)
      if (!b?.decision) return fail(res, 400, "bad_request", "decision required")
      const e = emit(deps, event("review.decided", { noteId, ...b }))
      return send(res, 200, { ok: true, seq: e.seq })
    }
    default:
      return fail(res, 404, "bad_request", `unknown note action "${action}"`)
  }
}

/** SSE: one multiplexed stream, replayed from `after`, heartbeat every 15s. */
function sse(deps: ServerDeps, req: IncomingMessage, res: ServerResponse, after: number) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  })

  for (const e of deps.store.since(after)) write(res, e)

  const unsubscribe = deps.bus.subscribe((e) => write(res, e))
  const beat = setInterval(() => res.write(":\n\n"), 15_000)

  req.on("close", () => {
    clearInterval(beat)
    unsubscribe()
  })
}

function write(res: ServerResponse, e: { seq: number; type: string }) {
  res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
}

function findBoardOf(store: Store, noteId: string): BoardView | null {
  for (const b of listBoards(store)) {
    const view = projectBoard(store, b.id)
    if (view?.notes.some((n) => n.id === noteId)) return view
  }
  return null
}

function emit(deps: ServerDeps, pending: Parameters<Store["append"]>[0]) {
  const e = deps.store.append(pending)
  deps.bus.publish(e)
  return e
}

async function json<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as T
  } catch {
    return null
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function fail(res: ServerResponse, status: number, code: ErrorCode, message: string) {
  send(res, status, { ok: false, error: { code, message } })
}
