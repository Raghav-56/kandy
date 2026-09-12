import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import {
  between,
  event,
  id,
  laneColumn,
  notesIn,
  type AgentId,
  type BoardView,
  type Delivery,
} from "@kandy/core"
import type { Store } from "./store.js"
import type { Bus } from "./bus.js"
import { adapter } from "./agents/index.js"
import {
  commitLeftovers,
  createWorktree,
  diffStat,
  isDirty,
  type Worktree,
} from "./worktree.js"

type Live = {
  runId: string
  noteId: string
  boardId: string
  agent: AgentId
  child: ChildProcess
  worktree: Worktree
  repoPath: string
}

type Queued = {
  runId: string
  noteId: string
  boardId: string
  agent: AgentId
  /** Overrides the note body — a steering follow-up carries its own prompt. */
  prompt?: string
  /** Reuse this worktree instead of creating one, for follow-ups. */
  worktree?: Worktree
}

/**
 * Owns every agent child process.
 *
 * Concurrency is the product: N notes run at once, each in its own worktree,
 * bounded by a slot limit so we don't melt the machine. Everything before this
 * is plumbing; this is the part that makes a board worth having.
 */
export class Runner {
  private live = new Map<string, Live>()
  private queue: Queued[] = []
  /** Worktree per note, so a follow-up resumes where the last run left off. */
  private worktrees = new Map<string, Worktree>()

  constructor(
    private store: Store,
    private bus: Bus,
    private getView: (boardId: string) => BoardView | null,
    private slots = 4,
  ) {}

  private emit(pending: Parameters<Store["append"]>[0]): void {
    this.bus.publish(this.store.append(pending))
  }

  /**
   * Move a note into the column for its current status.
   *
   * Called after every event that can change status. The reducer derives
   * status from run events, so this reads the freshly-projected view rather
   * than trying to predict it.
   */
  syncColumn(boardId: string, noteId: string): void {
    const view = this.getView(boardId)
    const note = view?.notes.find((n) => n.id === noteId)
    if (!view || !note) return

    const target = laneColumn(view, note.status)
    if (!target || target.id === note.columnId) return

    const last = notesIn(view, target.id).at(-1)
    this.emit(
      event("note.moved", {
        noteId,
        columnId: target.id,
        pos: between(last?.pos ?? null, null),
      }),
    )
  }

  /** Persist a transcript frame and push it to anyone watching, live. */
  private say(
    runId: string,
    role: "assistant" | "user" | "tool" | "system" | "error",
    text: string,
    meta?: string,
  ): void {
    this.bus.publish(this.store.appendTranscript(runId, role, text, meta))
  }

  request(boardId: string, noteId: string, agent: AgentId): string {
    const runId = id("run")
    this.emit(event("run.requested", { runId, noteId, agent }))
    this.syncColumn(boardId, noteId)
    this.queue.push({ runId, noteId, boardId, agent })
    void this.pump()
    return runId
  }

  /**
   * Steer a note.
   *
   * If the agent is live and accepts stdin, the message lands mid-turn. If not,
   * it becomes a follow-up run resuming the agent's session in the same
   * worktree — same intent, one turn later. The caller is told which happened,
   * because from the user's side the difference is the whole feel of the thing.
   */
  steer(boardId: string, noteId: string, text: string): Delivery {
    const live = [...this.live.values()].find((l) => l.noteId === noteId)
    if (live) {
      const encoded = adapter(live.agent)?.live?.encode(text)
      if (encoded && live.child.stdin?.writable) {
        live.child.stdin.write(encoded)
        this.say(live.runId, "user", text)
        return "live"
      }
    }

    const view = this.getView(boardId)
    const note = view?.notes.find((n) => n.id === noteId)
    const agent = note?.agent
    if (!agent) throw new Error("note has no agent assigned")

    const runId = id("run")
    this.emit(event("run.requested", { runId, noteId, agent }))
    this.say(runId, "user", text)
    this.queue.push({
      runId,
      noteId,
      boardId,
      agent,
      prompt: text,
      ...(this.worktrees.has(noteId) ? { worktree: this.worktrees.get(noteId)! } : {}),
    })
    void this.pump()
    return "queued"
  }

  /** Start queued runs while slots are free. */
  private async pump(): Promise<void> {
    while (this.live.size < this.slots && this.queue.length > 0) {
      const next = this.queue.shift()!
      try {
        await this.start(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.say(next.runId, "error", message)
        this.emit(
          event("run.finished", {
            runId: next.runId,
            noteId: next.noteId,
            status: "failed",
            exitCode: null,
            error: message,
          }),
        )
      }
    }
  }

  private async start(q: Queued): Promise<void> {
    const a = adapter(q.agent)
    if (!a) throw new Error(`no adapter for agent "${q.agent}"`)

    const view = this.getView(q.boardId)
    const note = view?.notes.find((n) => n.id === q.noteId)
    if (!view || !note) throw new Error(`note ${q.noteId} not found`)

    const worktree = q.worktree ?? (await createWorktree(view.board.repoPath, q.noteId, note.title))
    this.worktrees.set(q.noteId, worktree)

    // Resume the agent's session only when continuing in an existing worktree.
    // A fresh worktree means a fresh filesystem, and an agent whose memory
    // disagrees with what's on disk wastes a turn rediscovering that.
    const prior = q.worktree
      ? view.runs.filter((r) => r.noteId === q.noteId && r.agentSessionId).at(-1)?.agentSessionId
      : undefined

    const spec = a.spawn({
      cwd: worktree.path,
      prompt: q.prompt ?? note.body ?? note.title,
      policy: note.policy ?? "repo",
      ...(prior ? { resume: prior } : {}),
    })

    const child = spawn(spec.command, spec.args, {
      cwd: worktree.path,
      // The child inherits the user's existing CLI credentials. We never read,
      // store, or forward a token ourselves.
      env: { ...process.env, ...spec.env },
      // stdin stays open: it is how steering reaches agents that accept it.
      stdio: ["pipe", "pipe", "pipe"],
    })

    this.live.set(q.runId, {
      runId: q.runId,
      noteId: q.noteId,
      boardId: q.boardId,
      agent: q.agent,
      child,
      worktree,
      repoPath: view.board.repoPath,
    })

    this.emit(
      event("run.started", {
        runId: q.runId,
        noteId: q.noteId,
        worktree: worktree.path,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
        pid: child.pid ?? -1,
      }),
    )

    if ((note.policy ?? "repo") === "full") {
      this.say(q.runId, "system", "running with full access — this agent can do anything you can")
    }

    // Say plainly what the agent can and cannot see.
    //
    // A note branches from HEAD, so uncommitted work in the user's tree is
    // invisible to it. We used to refuse to start at all when the tree was
    // dirty — which makes the tool unusable during exactly the normal
    // development it exists to support. Warn, don't block: the footgun is
    // mild, and being told about it is the whole fix.
    if (await isDirty(view.board.repoPath).catch(() => false)) {
      this.say(
        q.runId,
        "system",
        `branched from ${worktree.baseRef.slice(0, 7)} — uncommitted changes in your working tree are not visible to this agent`,
      )
    }

    // Agents whose prompt travels over stdin get it now. The pipe stays open:
    // it is the same channel steering messages use later.
    if (spec.stdin && child.stdin?.writable) child.stdin.write(spec.stdin)

    this.syncColumn(q.boardId, q.noteId)
    this.consume(q.runId, child, (line) => a.parse(line))

    child.on("error", (err) => {
      this.say(q.runId, "error", err.message)
    })
    child.on("exit", (code, signal) => {
      void this.finish(q.runId, q.noteId, code, signal)
    })
  }

  /** Parse stdout line-by-line into events and transcript; stderr is captured raw. */
  private consume(
    runId: string,
    child: ChildProcess,
    parse: (line: string) => import("./agents/types.js").AgentEvent[],
  ): void {
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on("line", (line) => {
        let parsed: ReturnType<typeof parse>
        try {
          parsed = parse(line)
        } catch (err) {
          // A parser bug must not kill a run that is otherwise working.
          this.store.appendOutput(runId, "stdout", line)
          this.say(runId, "error", `adapter failed to parse output: ${String(err)}`)
          return
        }

        for (const ev of parsed) {
          switch (ev.kind) {
            case "session":
              this.emit(event("run.session", { runId, agentSessionId: ev.sessionId }))
              break
            case "text":
              if (ev.text.trim()) this.say(runId, "assistant", ev.text)
              break
            case "tool":
              this.say(runId, "tool", ev.detail, ev.tool)
              if (ev.status !== "started") {
                this.emit(event("run.tool", { runId, tool: ev.tool, status: ev.status }))
              }
              break
            case "usage":
              this.say(runId, "system", ev.text)
              break
            case "turn_end":
              // One run is one turn. Closing stdin lets the agent exit, which
              // finishes the run, frees the slot, and moves the note to review.
              // Steering sent *during* the turn still landed live; steering
              // after this point becomes a follow-up run that resumes the
              // session in the same worktree.
              child.stdin?.end()
              break
            case "blocked":
              this.say(runId, "system", ev.detail, "permission")
              this.emit(
                event("run.blocked", {
                  runId,
                  requestId: ev.requestId,
                  kind: "permission",
                  detail: ev.detail,
                }),
              )
              {
                const live = this.live.get(runId)
                if (live) this.syncColumn(live.boardId, live.noteId)
              }
              break
            case "error":
              this.say(runId, "error", ev.message)
              break
          }
        }
      })
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        // Raw stderr is kept for debugging but stays out of the transcript —
        // agent CLIs write progress spinners and deprecation notices there,
        // and a transcript full of noise is a transcript nobody reads.
        if (line.trim()) this.store.appendOutput(runId, "stderr", line)
      }
    })
  }

  private async finish(
    runId: string,
    noteId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const l = this.live.get(runId)
    this.live.delete(runId)

    let error: string | null = null
    let stat = ""
    if (l) {
      try {
        await commitLeftovers(l.worktree, `kandy: ${noteId}`)
        stat = await diffStat(l.worktree)
      } catch (err) {
        error = `failed to capture agent output: ${err instanceof Error ? err.message : err}`
        this.say(runId, "error", error)
      }
    }

    const status = signal ? "cancelled" : code === 0 ? "succeeded" : "failed"
    this.emit(event("run.finished", { runId, noteId, status, exitCode: code, error }))

    if (status === "succeeded" && l) {
      this.emit(event("review.opened", { noteId, runId, branch: l.worktree.branch, stat }))
    }
    if (l) this.syncColumn(l.boardId, noteId)
    void this.pump()
  }

  cancel(runId: string): boolean {
    const l = this.live.get(runId)
    if (!l) {
      const i = this.queue.findIndex((q) => q.runId === runId)
      if (i === -1) return false
      const [q] = this.queue.splice(i, 1)
      this.emit(
        event("run.finished", {
          runId,
          noteId: q!.noteId,
          status: "cancelled",
          exitCode: null,
          error: null,
        }),
      )
      return true
    }
    this.say(runId, "system", "cancelled by user")
    l.child.kill("SIGTERM")
    return true
  }

  /** Where a note's work lives, for diffing and review. */
  worktreeOf(noteId: string): Worktree | undefined {
    return this.worktrees.get(noteId)
  }

  forget(noteId: string): void {
    this.worktrees.delete(noteId)
  }

  /** Remember worktrees from previous daemon lifetimes so review still works. */
  adopt(view: BoardView): void {
    for (const n of view.notes) {
      if (n.worktree && n.branch && !this.worktrees.has(n.id)) {
        const run = view.runs.find((r) => r.id === n.runId)
        this.worktrees.set(n.id, {
          path: n.worktree,
          branch: n.branch,
          baseRef: run?.baseRef ?? "HEAD",
        })
      }
    }
  }

  /**
   * On startup, notes left in `running` by a crashed daemon are lies. Mark
   * them failed rather than showing a board that claims work is in flight.
   */
  reconcile(view: BoardView): void {
    this.adopt(view)

    // Put notes back in the lane their status says they belong to. A draft is
    // left wherever the user filed it — that placement is theirs — but a note
    // that ran is describing machine state, and the board must agree with it.
    for (const n of view.notes) {
      if (n.status !== "draft") this.syncColumn(view.board.id, n.id)
    }
    for (const run of view.runs) {
      if (run.status === "running" || run.status === "starting" || run.status === "blocked") {
        this.emit(
          event("run.finished", {
            runId: run.id,
            noteId: run.noteId,
            status: "failed",
            exitCode: null,
            error: "daemon restarted while this run was in flight",
          }),
        )
      }
    }
  }

  shutdown(): void {
    for (const l of this.live.values()) l.child.kill("SIGTERM")
  }
}
