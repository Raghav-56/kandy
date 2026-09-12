import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { event, id, type AgentId, type BoardView } from "@kandy/core"
import type { Store } from "./store.js"
import type { Bus } from "./bus.js"
import { adapter } from "./agents/index.js"
import type { AgentEvent } from "./agents/types.js"
import { commitLeftovers, createWorktree, type Worktree } from "./worktree.js"

type Live = {
  runId: string
  noteId: string
  child: ChildProcess
  worktree: Worktree
  repoPath: string
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
  private queue: { runId: string; noteId: string; agent: AgentId; boardId: string }[] = []

  constructor(
    private store: Store,
    private bus: Bus,
    private getView: (boardId: string) => BoardView | null,
    private slots = 4,
  ) {}

  private emit(pending: Parameters<Store["append"]>[0]): void {
    this.bus.publish(this.store.append(pending))
  }

  request(boardId: string, noteId: string, agent: AgentId): string {
    const runId = id("run")
    this.emit(event("run.requested", { runId, noteId, agent }))
    this.queue.push({ runId, noteId, agent, boardId })
    void this.pump()
    return runId
  }

  /** Start queued runs while slots are free. */
  private async pump(): Promise<void> {
    while (this.live.size < this.slots && this.queue.length > 0) {
      const next = this.queue.shift()!
      try {
        await this.start(next.boardId, next.runId, next.noteId, next.agent)
      } catch (err) {
        this.emit(
          event("run.finished", {
            runId: next.runId,
            noteId: next.noteId,
            status: "failed",
            exitCode: null,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }
  }

  private async start(
    boardId: string,
    runId: string,
    noteId: string,
    agentId: AgentId,
  ): Promise<void> {
    const a = adapter(agentId)
    if (!a) throw new Error(`no adapter for agent "${agentId}"`)

    const view = this.getView(boardId)
    const note = view?.notes.find((n) => n.id === noteId)
    if (!view || !note) throw new Error(`note ${noteId} not found`)

    const worktree = await createWorktree(view.board.repoPath, noteId, note.title)

    // Resume the agent's own session if this note has run here before, so a
    // `revise` keeps the conversation instead of starting cold.
    const prior = view.runs
      .filter((r) => r.noteId === noteId && r.agentSessionId)
      .at(-1)?.agentSessionId

    const spec = a.spawn({
      cwd: worktree.path,
      prompt: note.body || note.title,
      ...(prior ? { resume: prior } : {}),
    })

    const child = spawn(spec.command, spec.args, {
      cwd: worktree.path,
      // The child inherits the user's existing CLI credentials. We never read,
      // store, or forward a token ourselves.
      env: { ...process.env, ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
    })

    this.live.set(runId, { runId, noteId, child, worktree, repoPath: view.board.repoPath })

    this.emit(
      event("run.started", {
        runId,
        noteId,
        worktree: worktree.path,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
        pid: child.pid ?? -1,
      }),
    )

    this.consume(runId, child, a.parse.bind(a))

    child.on("exit", (code, signal) => {
      void this.finish(runId, noteId, code, signal)
    })
  }

  /** Parse stdout line-by-line into events; stderr is captured verbatim. */
  private consume(
    runId: string,
    child: ChildProcess,
    parse: (line: string) => AgentEvent[],
  ): void {
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on("line", (line) => {
        // Transcript goes to its own table — high volume, never in the board log.
        this.store.appendOutput(runId, "stdout", line)
        for (const ev of parse(line)) {
          switch (ev.kind) {
            case "session":
              this.emit(event("run.session", { runId, agentSessionId: ev.sessionId }))
              break
            case "tool":
              this.emit(event("run.tool", { runId, tool: ev.tool, status: ev.status }))
              break
            case "blocked":
              this.emit(
                event("run.blocked", {
                  runId,
                  requestId: ev.requestId,
                  kind: "permission",
                  detail: ev.detail,
                }),
              )
              break
            case "text":
            case "error":
              break
          }
        }
      })
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line) this.store.appendOutput(runId, "stderr", line)
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
    if (l) {
      try {
        await commitLeftovers(l.worktree, `kandy: ${noteId}`)
      } catch (err) {
        error = `failed to commit agent output: ${err instanceof Error ? err.message : err}`
      }
    }

    const status = signal ? "cancelled" : code === 0 ? "succeeded" : "failed"
    this.emit(event("run.finished", { runId, noteId, status, exitCode: code, error }))

    if (status === "succeeded" && l) {
      this.emit(event("review.opened", { noteId, runId, branch: l.worktree.branch }))
    }
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
    l.child.kill("SIGTERM")
    return true
  }

  /**
   * On startup, notes left in `running` by a crashed daemon are lies. Mark
   * them failed rather than leaving a board that claims work is in flight.
   */
  reconcile(view: BoardView): void {
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
