import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { homedir } from "node:os"
import path from "node:path"
import {
  between,
  event,
  id,
  isEphemeral,
  notesIn,
  type AgentId,
  type BoardView,
  type ErrorCode,
  type StreamFrame,
} from "@kandy/core"
import type { Runner } from "./runner.js"
import type { PrWatch } from "./prwatch.js"
import { detectForge, openPr } from "./forge.js"
import { serveStatic } from "./static.js"
import { describe, saveAttachments } from "./attach.js"
import { defaultModelFor, modelsFor, warmPrices } from "./pricing.js"
import { computeStats } from "./stats.js"
import { list as listDir, nativePick, suggestions } from "./browse.js"
import type { Engine } from "./engine.js"
import { detectAll } from "./agents/index.js"
import { coerceAttribution, commitTrailers, prBody } from "./attribution.js"
import {
  checkRepo,
  deleteBranch,
  diff as gitDiff,
  diffStat,
  mergeBranch,
  removeWorktree,
} from "./worktree.js"

import { authorized } from "./auth.js"

const VERSION = "0.0.0"
const STARTED = Date.now()

export type ServerDeps = { engine: Engine; runner: Runner; prs: PrWatch; token: string }

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

  // The web client always talks to "/api". In dev that is a Vite proxy; when
  // the daemon serves the bundle itself it is the same origin. Stripping the
  // prefix here means the client needs no knowledge of which it is.
  const apiPath = url.pathname.startsWith("/api/")
    ? url.pathname.slice(4)
    : url.pathname === "/api"
      ? "/"
      : null
  const routed = apiPath ?? url.pathname
  const parts = routed.split("/").filter(Boolean)

  // No cross-origin API access. The development UI uses Vite's /api proxy.
  // Validate Host too: a rebound attacker hostname must not expose the token.
  const port = req.socket.localPort
  const hosts = new Set([
    `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`,
    "127.0.0.1:5477", "localhost:5477", "[::1]:5477",
  ])
  const host = req.headers.host ?? ""
  const origin = req.headers.origin
  if (!hosts.has(host) || (origin !== undefined && origin !== `http://${host}`)) {
    return send(res, 403, { ok: false, error: { code: "forbidden", message: "Untrusted origin or host" } })
  }
  if (req.method === "OPTIONS") return void res.writeHead(204).end()

  if (req.method === "GET" && routed === "/auth/token") {
    // Custom headers require preflight cross-origin, which we never allow.
    if (req.headers["x-kandy-client"] !== "web" ||
        (req.headers["sec-fetch-site"] !== undefined && req.headers["sec-fetch-site"] !== "same-origin")) {
      return send(res, 403, { ok: false, error: { code: "forbidden", message: "Same-origin client required" } })
    }
    res.setHeader("Cache-Control", "no-store")
    return send(res, 200, { token: deps.token })
  }

  if (req.method !== "GET" && req.method !== "HEAD" && !authorized(req.headers.authorization, deps.token)) {
    res.setHeader("WWW-Authenticate", "Bearer")
    return send(res, 401, { ok: false, error: { code: "unauthorized", message: "Valid bearer token required" } })
  }

  if (req.method === "GET" && routed === "/health") {
    return send(res, 200, { version: VERSION, uptime: Date.now() - STARTED, pid: process.pid })
  }

  if (req.method === "GET" && routed === "/events") {
    return sse(deps, req, res, Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0))
  }

  // GET /agents/:id/models — a menu for the model pickers
  if (req.method === "GET" && parts[0] === "agents" && parts[2] === "models") {
    await warmPrices()
    return send(res, 200, { models: modelsFor(parts[1]!) })
  }

  if (req.method === "GET" && routed === "/agents") {
    return send(res, 200, { agents: await detectAll() })
  }

  // GET /repo/browse?path=... — directory listing for the picker
  if (req.method === "GET" && routed === "/repo/browse") {
    const p = url.searchParams.get("path")
    try {
      return send(res, 200, {
        ...listDir(p ?? homedir()),
        suggestions: suggestions(),
      })
    } catch (err) {
      return fail(res, 400, "bad_request", err instanceof Error ? err.message : String(err))
    }
  }

  // POST /repo/pick — the OS folder chooser, where the platform has one
  if (req.method === "POST" && routed === "/repo/pick") {
    const picked = await nativePick()
    return send(res, 200, { path: picked, supported: process.platform === "darwin" })
  }

  if (req.method === "GET" && routed === "/repo/check") {
    const p = url.searchParams.get("path") ?? ""
    return send(res, 200, await checkRepo(expandHome(p)))
  }

  if (req.method === "GET" && routed === "/boards") {
    return send(res, 200, { boards: deps.engine.projections.boards() })
  }

  if (req.method === "POST" && routed === "/boards") {
    const body = await json<{
      name?: string
      repoPath: string
      setup?: string | null
      carry?: string[]
      defaultPolicy?: "repo" | "full"
    }>(req)
    if (!body?.repoPath) return fail(res, 400, "bad_request", "repoPath required")
    if (body.defaultPolicy !== undefined && body.defaultPolicy !== "repo" && body.defaultPolicy !== "full")
      return fail(res, 400, "bad_request", "defaultPolicy must be 'repo' or 'full'")

    // Validate here rather than at first run. A board pointed at a
    // non-repo is a board that looks fine until the moment it matters.
    const check = await checkRepo(expandHome(body.repoPath))
    if (!check.isRepo) {
      return fail(res, 400, "not_a_repo", check.error ?? `${body.repoPath} is not a git repository`)
    }

    const boardId = id("board")
    const name = body.name?.trim() || check.name || "board"

    // Pick a default model per installed agent rather than leaving every new
    // board on "whatever the agent feels like". A stated default is something
    // you can disagree with; an unstated one is something you discover.
    await warmPrices()
    const models: Record<string, string> = {}
    for (const a of await detectAll()) {
      if (!a.installed) continue
      const pick = defaultModelFor(a.id)
      if (pick) models[a.id] = pick
    }
    emit(
      deps,
      event("board.created", {
        boardId,
        name,
        repoPath: check.path,
        // Default to what the repo's lockfiles imply, so a board works on
        // first run without anyone having to know this setting exists.
        setup: body.setup === undefined ? check.suggestedSetup : body.setup,
        carry: body.carry ?? check.suggestedCarry,
        models,
        // A new repo is repo-only until someone looks at it and decides
        // otherwise. Full access is never something we pick for you.
        defaultPolicy: body.defaultPolicy ?? "repo",
      }),
    )
    // Seed the lifecycle lanes. Each declares the lane it represents, so the
    // server can move notes between them as their status changes.
    const LANES = [
      { name: "Inbox", lane: "inbox" },
      { name: "Queued", lane: "queued" },
      { name: "Running", lane: "running" },
      { name: "Review", lane: "review" },
      { name: "Done", lane: "done" },
    ] as const
    for (const [i, col] of LANES.entries()) {
      emit(
        deps,
        event("column.created", {
          columnId: id("col"),
          boardId,
          name: col.name,
          lane: col.lane,
          pos: between(null, null) + String(i),
        }),
      )
    }
    const view = deps.engine.view(boardId)!
    return send(res, 200, { ok: true, seq: view.seq, board: view.board })
  }

  // GET /boards/:id/stats
  if (req.method === "GET" && parts[0] === "boards" && parts[2] === "stats") {
    const view = deps.engine.view(parts[1]!)
    if (!view) return fail(res, 404, "board_not_found", "no such board")
    return send(res, 200, computeStats(view, deps.engine.store))
  }

  // GET /boards/:id/forge
  if (req.method === "GET" && parts[0] === "boards" && parts[2] === "forge") {
    const view = deps.engine.view(parts[1]!)
    if (!view) return fail(res, 404, "board_not_found", "no such board")
    return send(res, 200, await detectForge(view.board.repoPath))
  }

  // POST /boards/:id/remove
  if (req.method === "POST" && parts[0] === "boards" && parts[2] === "remove") {
    const board = deps.engine.view(parts[1]!)
    if (!board) return fail(res, 404, "board_not_found", "no such board")
    // Worktrees live inside the user's repo; leaving them behind would be
    // litter in a directory kandy no longer tracks.
    for (const note of board.notes) {
      const wt = deps.runner.worktreeOf(note.id)
      if (wt) {
        await removeWorktree(board.board.repoPath, wt.path, true).catch(() => {})
        await deleteBranch(board.board.repoPath, wt.branch)
        deps.runner.forget(note.id)
      }
    }
    const e = emit(deps, event("board.removed", { boardId: parts[1]! }))
    return send(res, 200, { ok: true, seq: e.seq })
  }

  // POST /boards/:id/models
  if (req.method === "POST" && parts[0] === "boards" && parts[2] === "models") {
    const b = await json<{ models: Record<string, string> }>(req)
    if (!deps.engine.view(parts[1]!)) return fail(res, 404, "board_not_found", "no such board")
    const e = emit(deps, event("board.models", { boardId: parts[1]!, models: b?.models ?? {} }))
    return send(res, 200, { ok: true, seq: e.seq })
  }

  // POST /boards/:id/policy — what notes written here start as
  if (req.method === "POST" && parts[0] === "boards" && parts[2] === "policy") {
    const b = await json<{ defaultPolicy: "repo" | "full" }>(req)
    if (b?.defaultPolicy !== "repo" && b?.defaultPolicy !== "full")
      return fail(res, 400, "bad_request", "defaultPolicy must be 'repo' or 'full'")
    if (!deps.engine.view(parts[1]!)) return fail(res, 404, "board_not_found", "no such board")
    const e = emit(
      deps,
      event("board.policy", { boardId: parts[1]!, defaultPolicy: b.defaultPolicy }),
    )
    return send(res, 200, { ok: true, seq: e.seq })
  }

  // POST /boards/:id/attribution
  if (req.method === "POST" && parts[0] === "boards" && parts[2] === "attribution") {
    const body = await json<{ attribution: unknown }>(req)
    if (!deps.engine.view(parts[1]!)) return fail(res, 404, "board_not_found", "no such board")
    // Coerced rather than trusted: a half-sent object must resolve to "off"
    // for the key it omitted, never to "on" by accident. Writing someone's
    // git history because a field was undefined is not a mistake to allow.
    const e = emit(
      deps,
      event("board.attribution", {
        boardId: parts[1]!,
        attribution: coerceAttribution(body?.attribution),
      }),
    )
    return send(res, 200, { ok: true, seq: e.seq })
  }

  // POST /boards/:id/setup
  if (req.method === "POST" && parts[0] === "boards" && parts[2] === "setup") {
    const body = await json<{ setup: string | null; carry?: string[] }>(req)
    if (!deps.engine.view(parts[1]!)) return fail(res, 404, "board_not_found", "no such board")
    const e = emit(
      deps,
      event("board.setup", {
        boardId: parts[1]!,
        setup: body?.setup ?? null,
        ...(body?.carry ? { carry: body.carry } : {}),
      }),
    )
    return send(res, 200, { ok: true, seq: e.seq })
  }

  // GET /boards/:id/view
  if (req.method === "GET" && parts[0] === "boards" && parts[2] === "view") {
    const view = deps.engine.view(parts[1]!)
    if (!view) return fail(res, 404, "board_not_found", `no board ${parts[1]}`)
    return send(res, 200, view)
  }

  if (req.method === "POST" && routed === "/notes") {
    const body = await json<{ boardId: string; columnId: string; title: string; body?: string }>(req)
    if (!body?.boardId || !body?.columnId || !body?.title)
      return fail(res, 400, "bad_request", "boardId, columnId and title required")

    const view = deps.engine.view(body.boardId)
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

  // GET /notes/:id/diff
  //
  // The live worktree is the truth while it exists — a note can still be
  // running, and its diff grows under us. Once review is decided the worktree
  // is gone, so we fall back to the snapshot taken when review opened.
  if (req.method === "GET" && parts[0] === "notes" && parts[2] === "diff") {
    const noteId = parts[1]!
    const wt = deps.runner.worktreeOf(noteId)
    if (wt) {
      try {
        const [diff, stat] = await Promise.all([gitDiff(wt), diffStat(wt)])
        return send(res, 200, {
          diff,
          stat,
          branch: wt.branch,
          // Where "merge here" would put it, so the confirmation can say so.
          baseBranch: wt.baseBranch,
          capturedAt: null,
        })
      } catch {
        // Worktree remembered but no longer on disk. The snapshot is all we have.
      }
    }
    const saved = deps.engine.store.savedDiff(noteId)
    if (!saved)
      return send(res, 200, { diff: "", stat: "", branch: null, baseBranch: null, capturedAt: null })
    return send(res, 200, {
      diff: saved.diff,
      stat: saved.stat,
      branch: saved.branch,
      baseBranch: null,
      capturedAt: saved.ts,
    })
  }

  // POST /notes/:id/<action>
  if (req.method === "POST" && parts[0] === "notes" && parts[1]) {
    return noteAction(deps, res, parts[1], parts[2] ?? "", req)
  }

  // GET /runs/:id/transcript
  if (req.method === "GET" && parts[0] === "runs" && parts[2] === "transcript") {
    const after = Number(url.searchParams.get("after") ?? 0)
    const frames = deps.engine.store.transcriptSince(parts[1]!, after)
    return send(res, 200, { frames, nextAfter: frames.at(-1)?.seq ?? null })
  }

  // POST /runs/:id/cancel
  if (req.method === "POST" && parts[0] === "runs" && parts[2] === "cancel") {
    return send(res, 200, { ok: true, seq: deps.engine.head(), cancelled: deps.runner.cancel(parts[1]!) })
  }

  // GET /runs/:id/output
  if (req.method === "GET" && parts[0] === "runs" && parts[2] === "output") {
    const after = Number(url.searchParams.get("after") ?? 0)
    const lines = deps.engine.store.outputSince(parts[1]!, after)
    return send(res, 200, { lines, nextAfter: lines.at(-1)?.seq ?? null })
  }

  // Anything that isn't the API is the web client, if one is built.
  if (req.method === "GET" && apiPath === null && serveStatic(url.pathname, res)) return

  return fail(res, 404, "bad_request", `no route for ${req.method} ${url.pathname}`)
}

async function noteAction(
  deps: ServerDeps,
  res: ServerResponse,
  noteId: string,
  action: string,
  req: IncomingMessage,
) {
  const view = deps.engine.boardOf(noteId)
  if (!view) return fail(res, 404, "note_not_found", `no note ${noteId}`)
  const note = view.notes.find((n) => n.id === noteId)
  if (!note) return fail(res, 404, "note_not_found", `no note ${noteId}`)

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
    case "pr": {
      if (!note.branch) return fail(res, 409, "no_branch", "this note has not produced a branch yet")

      const forge = await detectForge(view.board.repoPath)
      if (!forge.available) return fail(res, 409, "no_forge", forge.reason ?? "no forge available")

      const b = await json<{ draft?: boolean }>(req)
      try {
        const pr = await openPr(
          view.board.repoPath,
          note.branch,
          note.title,
          prBody(note, {
            model: note.model ?? (note.agent ? view.board.models?.[note.agent] : null) ?? null,
            footer: view.board.attribution?.pr === true,
          }),
          b?.draft ?? false,
        )
        const e = emit(deps, event("note.pr", { noteId, pr }))
        return send(res, 200, { ok: true, seq: e.seq, pr })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // A PR may already exist for this branch; if so, adopt it rather than
        // reporting a failure the user can do nothing about.
        await deps.prs.refresh(view.board.id, noteId)
        const now = deps.engine.boardOf(noteId)?.notes.find((n) => n.id === noteId)
        if (now?.pr) return send(res, 200, { ok: true, seq: deps.engine.head(), pr: now.pr })
        return fail(res, 409, "internal", message)
      }
    }

    case "model": {
      const b = await json<{ model: string | null }>(req)
      const model = b?.model?.trim() || null
      const e = emit(deps, event("note.model", { noteId, model }))
      return send(res, 200, { ok: true, seq: e.seq })
    }

    case "policy": {
      const b = await json<{ policy: "repo" | "full" }>(req)
      if (b?.policy !== "repo" && b?.policy !== "full")
        return fail(res, 400, "bad_request", "policy must be 'repo' or 'full'")
      const e = emit(deps, event("note.policy", { noteId, policy: b.policy }))
      return send(res, 200, { ok: true, seq: e.seq })
    }

    /**
     * Answer a refusal, once, for this note.
     *
     * Deliberately not an in-flight permission answer — that needs the
     * `canUseTool` callback and the agent running in-process, which is a
     * different architecture (see docs/09-open-questions.md). This is the
     * pragmatic version: the policy changes, and the agent is resumed in the
     * same worktree with what it was refused now permitted.
     */
    case "escalate": {
      if (!note.agent) return fail(res, 400, "bad_request", "note has no agent assigned")
      // There is nothing to continue from. Setting the policy and running from
      // scratch is what the note's own toggle and Run button are for.
      if (!note.runId)
        return fail(res, 409, "invalid_transition", "this note has not run yet — set its policy and run it")

      if (note.policy !== "full") emit(deps, event("note.policy", { noteId, policy: "full" }))

      try {
        const delivery = deps.runner.escalate(view.board.id, noteId)
        return send(res, 200, { ok: true, seq: deps.engine.head(), delivery })
      } catch (err) {
        return fail(res, 400, "bad_request", err instanceof Error ? err.message : String(err))
      }
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

      const runId = deps.runner.request(view.board.id, noteId, agent)
      return send(res, 200, { ok: true, seq: deps.engine.head(), runId })
    }
    case "message": {
      const b = await json<{ text: string; files?: { name: string; data: string }[] }>(req)
      if (!b?.text?.trim() && !b?.files?.length)
        return fail(res, 400, "bad_request", "text or files required")

      // Attachments go into the note's worktree, so the path we hand the agent
      // is one it can actually open.
      let text = (b.text ?? "").trim()
      if (b.files?.length) {
        const wt = deps.runner.worktreeOf(noteId)
        if (!wt) return fail(res, 409, "no_branch", "this note has no workspace yet — run it first")
        text += describe(saveAttachments(wt.path, b.files))
      }

      try {
        const delivery = deps.runner.steer(view.board.id, noteId, text)
        return send(res, 200, { ok: true, seq: deps.engine.head(), delivery })
      } catch (err) {
        return fail(res, 400, "bad_request", err instanceof Error ? err.message : String(err))
      }
    }

    case "review": {
      const b = await json<{ decision: "merge" | "discard" | "revise"; comment?: string }>(req)
      if (!b?.decision) return fail(res, 400, "bad_request", "decision required")

      // `revise` is steering, not a verdict: keep the worktree and the
      // session, hand the agent the comment, and let it keep going.
      if (b.decision === "revise") {
        if (!b.comment?.trim())
          return fail(res, 400, "bad_request", "revise needs a comment saying what to change")
        const delivery = deps.runner.steer(view.board.id, noteId, b.comment.trim())
        const e = emit(deps, event("review.decided", { noteId, decision: "revise", comment: b.comment }))
        return send(res, 200, { ok: true, seq: e.seq, delivery })
      }

      const wt = deps.runner.worktreeOf(noteId)
      if (wt) {
        if (b.decision === "merge") {
          // The merge commit is the one commit that is definitely still in
          // history after the branch is deleted, so it is the one worth
          // signing — when the board asked to be signed at all.
          const trailers = view.board.attribution?.commit
            ? commitTrailers({
                noteId,
                runId: note.runId,
                agent: note.agent,
                model:
                  note.model ?? (note.agent ? view.board.models?.[note.agent] : null) ?? null,
              })
            : []
          const result = await mergeBranch(view.board.repoPath, wt.branch, trailers)
          if (!result.merged) {
            // Leave everything exactly as it was. A conflict is the user's
            // call, and they still have the branch and the worktree.
            return fail(
              res,
              409,
              "worktree_failed",
              `merge conflict on ${wt.branch} — resolve it yourself, the branch is intact:\n${result.conflict ?? ""}`,
            )
          }
        }
        // Both verdicts end the same way: the worktree and the branch have
        // served their purpose. A merged branch is safe to delete — the
        // --no-ff merge commit names it, so the history stays readable — and a
        // branch per note piles up fast if we keep them.
        await removeWorktree(view.board.repoPath, wt.path, true).catch(() => {})
        await deleteBranch(view.board.repoPath, wt.branch)
        deps.runner.forget(noteId)
      }

      const e = emit(deps, event("review.decided", { noteId, ...b }))
      deps.runner.syncColumn(view.board.id, noteId)
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

  for (const e of deps.engine.store.since(after)) write(res, e)

  const unsubscribe = deps.engine.bus.subscribe((f) => write(res, f))
  const beat = setInterval(() => res.write(":\n\n"), 15_000)

  req.on("close", () => {
    clearInterval(beat)
    unsubscribe()
  })
}

function write(res: ServerResponse, f: StreamFrame) {
  // Transcript frames deliberately carry no `id:`. Per the SSE spec that
  // leaves the client's Last-Event-ID untouched, so a reconnect resumes the
  // domain log exactly where it left off instead of replaying agent chatter.
  if (isEphemeral(f)) {
    res.write(`event: ${f.kind}\ndata: ${JSON.stringify(f)}\n\n`)
    return
  }
  res.write(`id: ${f.seq}\nevent: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)
}

/** `~/code/thing` is what people actually type. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p
}

function emit(deps: ServerDeps, pending: Parameters<Engine["emit"]>[0]) {
  return deps.engine.emit(pending)
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
