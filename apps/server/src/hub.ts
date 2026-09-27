import type { IncomingMessage, ServerResponse } from "node:http"
import {
  COMMAND_EVENT,
  RUNNER_PROTOCOL,
  event,
  id,
  isEphemeral,
  subjectOf,
  type ActorId,
  type Hello,
  type HelloReply,
  type LogBatch,
  type Reply,
  type RunnerId,
  type RunnerInfo,
  type StreamFrame,
} from "@kandy/core"
import type { Engine } from "./engine.js"

/**
 * The hub's side of the runner protocol: who is connected, what they may
 * write, and how to ask one of them to do something.
 *
 * Deliberately imports nothing that touches a repository or an agent — see
 * the boundary test. Everything that needs a checkout is a command sent to
 * the runner that has one.
 */

/** A command outlives a slow `git merge`, not a dead runner. */
const CALL_TIMEOUT_MS = 120_000

type Connected = RunnerInfo & {
  stream: ServerResponse | null
}

type Pending = {
  runnerId: RunnerId
  resolve: (v: unknown) => void
  reject: (e: Error & { status?: number; code?: string }) => void
  timer: ReturnType<typeof setTimeout>
}

/** Three missed check-ins (runners send one every 20s). */
const STALE_MS = 60_000

export class Runners {
  private runners = new Map<RunnerId, Connected>()
  private pending = new Map<string, Pending>()

  constructor(private readonly engine: Engine) {
    /*
     * A runner can vanish without its connection closing — a process killed
     * with its terminal, a laptop that slept — and a proxy in between (such
     * as `tailscale serve`) may hold the socket open indefinitely. Runners
     * check in every 20s; one silent for a minute is dropped, which runs the
     * ordinary "went offline" path below.
     */
    setInterval(() => this.sweep(), 15_000).unref()
  }

  /** Drop runners not heard from in `staleMs`. Public for tests. */
  sweep(now = Date.now(), staleMs = STALE_MS): void {
    for (const r of this.runners.values()) {
      if (r.stream && now - r.lastSeen > staleMs) r.stream.destroy()
    }
  }

  // ── what a runner sends ─────────────────────────────────────────────────

  /**
   * A runner introducing itself, or reintroducing itself after a reconnect.
   *
   * `owner` comes from the authenticated connection — the Tailscale login
   * behind it, or null on a single-player hub — and overrides anything the
   * runner might claim. A runner that has been seen before under a different
   * owner is refused: a machine id is not a thing to be taken over by
   * whoever presents it next.
   */
  hello(h: Hello, owner: ActorId | null): HelloReply {
    if (h.protocol !== RUNNER_PROTOCOL) {
      throw status(426, `this hub speaks runner protocol ${RUNNER_PROTOCOL}; the runner sent ${h.protocol} — upgrade kandy on one of them`)
    }
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(h.runnerId ?? "")) throw status(400, "runnerId is malformed")

    const known = this.runners.get(h.runnerId)
    if (known && known.owner !== owner) throw status(403, "that runner belongs to someone else")

    this.runners.set(h.runnerId, {
      runnerId: h.runnerId,
      name: String(h.name ?? "").slice(0, 120) || h.runnerId,
      os: String(h.os ?? "").slice(0, 40),
      owner,
      agents: Array.isArray(h.agents) ? h.agents : [],
      boards: Array.isArray(h.boards) ? h.boards.filter((b) => typeof b === "string") : [],
      online: known?.online ?? false,
      lastSeen: Date.now(),
      stream: known?.stream ?? null,
    })
    return { ok: true, protocol: RUNNER_PROTOCOL, owner }
  }

  /**
   * Hold a runner's stream open: everything it missed, a marker, then live.
   *
   * Replayed in pages, not with one `since` call — that is capped at ten
   * thousand events, and a runner joining a board with a long history has
   * to see all of it or it decides by a board that is not the real one.
   */
  attach(runnerId: RunnerId, owner: ActorId | null, req: IncomingMessage, res: ServerResponse, after: number): void {
    const r = this.runners.get(runnerId)
    if (!r) throw status(409, "say hello first")
    if (r.owner !== owner) throw status(403, "that runner belongs to someone else")

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })

    let cursor = after
    for (;;) {
      const page = this.engine.store.since(cursor, 5000)
      for (const e of page) write(res, e)
      if (page.length < 5000) break
      cursor = page.at(-1)!.seq
    }
    res.write(`event: caught-up\ndata: {}\n\n`)

    // A second stream from the same runner replaces the first: it is the
    // same machine reconnecting, and the old socket is already dead or dying.
    r.stream?.end()
    r.stream = res
    r.online = true
    r.lastSeen = Date.now()

    // Domain events only. Transcripts are for people, and a runner wrote them.
    const unsubscribe = this.engine.bus.subscribe((f) => {
      if (!isEphemeral(f)) write(res, f)
    })
    const beat = setInterval(() => res.write(":\n\n"), 15_000)

    req.on("close", () => {
      clearInterval(beat)
      unsubscribe()
      if (r.stream !== res) return
      r.stream = null
      r.online = false
      r.lastSeen = Date.now()
      // Anything this runner was asked and never answered will never be
      // answered by this connection. Failing it now beats a caller waiting
      // two minutes to learn the machine went to sleep.
      for (const [cid, p] of this.pending) {
        if (p.runnerId !== runnerId) continue
        clearTimeout(p.timer)
        this.pending.delete(cid)
        p.reject(status(503, `${r.name} went offline`))
      }
    })
  }

  /**
   * What a runner's runs did, appended in order.
   *
   * Every write must be about a note placed on this runner — the hub placed
   * it there before asking, so there is nothing legitimate a runner can write
   * about any other. Checked for the whole batch before any of it is applied:
   * half a batch is a transcript with a hole in it.
   */
  log(batch: LogBatch, owner: ActorId | null): void {
    const r = this.runners.get(batch.runnerId)
    if (!r) throw status(409, "say hello first")
    if (r.owner !== owner) throw status(403, "that runner belongs to someone else")
    if (!Array.isArray(batch.ops)) throw status(400, "ops must be a list")

    const noteOfRun = (runId: string) => this.noteOfRun(runId)
    for (const op of batch.ops) {
      const note =
        op.op === "emit"
          ? subjectOf(op.pending, noteOfRun)
          : op.op === "saveDiff"
            ? op.noteId
            : noteOfRun(op.runId)
      if (!note) throw status(403, `a runner may only write about notes; ${describe(op)} names none`)
      if (this.placement(note) !== batch.runnerId) {
        throw status(403, `note ${note} is not placed on this runner`)
      }
      if (op.op === "emit" && op.pending.type === "note.placed") {
        throw status(403, "only the hub places notes")
      }
    }

    r.lastSeen = Date.now()
    for (const op of batch.ops) {
      switch (op.op) {
        case "emit":
          // The actor is the runner's owner, from the connection. Nothing in
          // the event says who; nothing in it could be trusted to.
          this.engine.emit(op.pending, owner)
          break
        case "say":
          this.engine.say(op.runId, op.role, op.text, op.meta)
          break
        case "activity":
          this.engine.activity(op.runId, op.tool, op.detail)
          break
        case "output":
          this.engine.store.appendOutput(op.runId, op.channel, op.text)
          break
        case "saveDiff":
          this.engine.store.saveDiff(op.noteId, op.snapshot)
          break
      }
    }
  }

  reply(r: Reply, owner: ActorId | null): void {
    const p = this.pending.get(r.id)
    // Unknown is not an error worth raising: it timed out, or the runner
    // answered twice. Either way nobody is waiting.
    if (!p) return
    if (p.runnerId !== r.runnerId || this.runners.get(r.runnerId)?.owner !== owner) {
      throw status(403, "that command was not sent to you")
    }
    clearTimeout(p.timer)
    this.pending.delete(r.id)
    if (r.ok) p.resolve(r.result)
    else {
      const code = (r as { code?: string }).code
      p.reject(
        Object.assign(new Error(r.error), {
          ...(r.status !== undefined ? { status: r.status } : {}),
          ...(code !== undefined ? { code } : {}),
        }),
      )
    }
  }

  // ── what the hub asks ───────────────────────────────────────────────────

  /** Ask one runner to do one thing, and wait for its answer. */
  call<T = unknown>(runnerId: RunnerId, op: string, args: unknown[], timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
    const r = this.runners.get(runnerId)
    if (!r?.stream) return Promise.reject(status(503, `${r?.name ?? runnerId} is offline`))

    const cid = id("cmd")
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cid)
        reject(status(504, `${r.name} did not answer ${op}`))
      }, timeoutMs)
      this.pending.set(cid, { runnerId, resolve: resolve as (v: unknown) => void, reject, timer })
      r.stream!.write(`event: ${COMMAND_EVENT}\ndata: ${JSON.stringify({ id: cid, op, args })}\n\n`)
    })
  }

  /**
   * Give a note to a runner. Recorded in the log, so it survives the hub
   * restarting and the board can say where the work is.
   */
  place(noteId: string, runnerId: RunnerId, actor: ActorId | null): void {
    if (this.placement(noteId) === runnerId) return
    this.engine.emit(event("note.placed", { noteId, runnerId }), actor)
  }

  /** Where a note's checkout is, per the log. */
  placement(noteId: string): RunnerId | null {
    return this.engine.boardOf(noteId)?.notes.find((n) => n.id === noteId)?.runner ?? null
  }

  /**
   * An online runner that can work on this board, preferring one the given
   * person owns. Their own machine first: that is the whole premise.
   */
  pick(boardId: string, prefer: ActorId | null): Connected | null {
    const able = [...this.runners.values()].filter((r) => r.stream && r.boards.includes(boardId))
    return able.find((r) => r.owner === prefer) ?? (prefer === null ? able[0] ?? null : null)
  }

  get(runnerId: RunnerId): Connected | null {
    return this.runners.get(runnerId) ?? null
  }

  list(): RunnerInfo[] {
    return [...this.runners.values()].map(({ stream: _stream, ...info }) => info)
  }

  /** Agents across every online runner, for a board that asks "what can run here?". */
  agents(): RunnerInfo["agents"] {
    const seen = new Map<string, RunnerInfo["agents"][number]>()
    for (const r of this.runners.values()) {
      if (!r.stream) continue
      for (const a of r.agents) {
        const had = seen.get(a.id)
        // Ready somewhere is ready: the note will go to that machine.
        if (!had || (!had.authed && a.authed)) seen.set(a.id, a)
      }
    }
    return [...seen.values()]
  }

  private noteOfRun(runId: string): string | null {
    for (const b of this.engine.projections.boards()) {
      const run = this.engine.view(b.id)?.runs.find((x) => x.id === runId)
      if (run) return run.noteId
    }
    return null
  }
}

function write(res: ServerResponse, f: StreamFrame) {
  if (isEphemeral(f)) return
  res.write(`id: ${f.seq}\nevent: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)
}

function describe(op: { op: string; pending?: { type: string } }): string {
  return op.op === "emit" ? op.pending!.type : op.op
}

export function status(code: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: code })
}
