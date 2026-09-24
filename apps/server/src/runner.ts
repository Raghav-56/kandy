import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import {
  between,
  event,
  id,
  INTERRUPTED,
  isAuthFailure,
  laneColumn,
  notesIn,
  type AgentId,
  type BoardView,
  type CostSource,
  type Delivery,
  type DiffStat,
  type Log,
  envRefs,
  type PendingEvent,
  type TranscriptFrame,
} from "@kandy/core"
import { priorRuns, promptForRun } from "./handoff.js"
import { takeStripped } from "./gc.js"
import { recordLimits } from "./limits.js"
import { authFailures, clearAuthFailure, recordAuthFailure } from "./auth-failures.js"
import type { AskChannel } from "./agents/types.js"
import { closeAskChannel, openAskChannel, type Permissions } from "./permission.js"
import { adapter } from "./agents/index.js"
import { adoptStaged, describe as describeAttachments } from "./attach.js"
import { commitTrailers } from "./attribution.js"
import { composeCommitMessage } from "./message.js"
import { priceUsage } from "./pricing.js"
import {
  carryInto,
  commitLeftovers,
  removeWorktree,
  retireWorktree,
  createWorktree,
  diff as gitDiff,
  diffNumbers,
  diffStat,
  isDirty,
  runSetup,
  type Worktree,
} from "./worktree.js"

/**
 * What the agent is told when its note is escalated.
 *
 * It names the change rather than just saying "continue", because the agent
 * is resuming a session in which it was refused and has already reasoned its
 * way around the refusal.
 */
const CONTINUE_WITH_FULL =
  "Full access has been granted for this note — shell commands that were refused will now run. " +
  "Continue from where you left off, starting with whatever you were blocked on."

type Live = {
  runId: string
  noteId: string
  boardId: string
  agent: AgentId
  child: ChildProcess
  worktree: Worktree
  repoPath: string
  /** The MCP config this run's prompts travel through, if it can be asked. */
  ask?: AskChannel
  /** Reverses whatever the adapter's `prepare` put in the worktree. */
  undo?: () => Promise<void>
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
  /** Follow-ups held until a note's current run has actually exited. */
  private pending = new Map<string, { boardId: string; text: string }>()

  constructor(
    /**
     * Where everything this runner learns goes.
     *
     * An interface rather than the `Engine` it used to be, so that the same
     * runner works whether the log is in this process or on a hub across a
     * network. See `packages/core/src/log.ts` — that swap is the whole of the
     * hub/runner split.
     */
    private log: Log,
    private slots = 4,
    /** Called when a note's branch is ready to be looked up on the forge. */
    private onBranchReady?: (boardId: string, noteId: string) => void,
    /**
     * Where an agent's permission prompts go, and what they need to get back.
     * Absent in tests and in any deployment that would rather auto-deny.
     */
    private asking?: { permissions: Permissions; port: number; token: string },
  ) {}

  /** Which note and board a live run belongs to. The broker's only view in. */
  locate(runId: string): { boardId: string; noteId: string } | null {
    const l = this.live.get(runId)
    return l ? { boardId: l.boardId, noteId: l.noteId } : null
  }

  private emit(pending: PendingEvent): void {
    this.log.emit(pending)
  }

  private getView(boardId: string): BoardView | null {
    return this.log.view(boardId)
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
  /** Last notice written per run, to suppress immediate repeats. */
  private lastNotice = new Map<string, string>()

  /**
   * Agents whose last run could not authenticate.
   *
   * A credential file is a guess — Claude Code's local init succeeds on cached
   * credentials, so the certain signal that a sign-in is dead is a run failing
   * to use it. Kept beside the daemon rather than in the log: it is an
   * observation about this machine, not a fact about the board. It used to be
   * kept in memory, which meant a restart reported a revoked token as ready;
   * `auth-failures.ts` says how it now expires instead.
   *
   * Cleared the moment that agent completes a run, because whatever was wrong
   * plainly is not any more.
   */
  agentsFailingAuth(): { agent: AgentId; at: number }[] {
    return authFailures()
  }

  private say(
    runId: string,
    role: "assistant" | "user" | "tool" | "system" | "error",
    text: string,
    meta?: string,
  ): void {
    // Agents re-announce their standing conditions every turn — Codex repeats
    // its hook-trust warning and its truncated-skills notice each time. Saying
    // the same thing twice in a row trains people to skim the notices that
    // matter, so a consecutive duplicate is dropped.
    if (role === "error") {
      // Noticed here rather than at exit, so it is caught whichever path the
      // failure takes out of a run.
      const agent = this.live.get(runId)?.agent
      if (agent && isAuthFailure(text)) recordAuthFailure(agent)
    }

    if (role === "system" || role === "error") {
      const key = `${role}:${text}`
      if (this.lastNotice.get(runId) === key) return
      this.lastNotice.set(runId, key)
    } else {
      this.lastNotice.delete(runId)
    }
    this.log.say(runId, role, text, meta)
  }

  request(boardId: string, noteId: string, agent: AgentId): string {
    const runId = id("run")
    this.emit(event("run.requested", { runId, noteId, agent }))
    this.syncColumn(boardId, noteId)

    // A note has one workspace, not one per attempt. Retrying used to try to
    // create a second worktree on a branch that already existed, which fails
    // outright — and if it had succeeded it would have left the first attempt's
    // work stranded on an orphan branch.
    const existing = this.worktrees.get(noteId)
    this.queue.push({
      runId,
      noteId,
      boardId,
      agent,
      ...(existing ? { worktree: existing } : {}),
    })
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

    this.followUp(boardId, noteId, text)
    return "queued"
  }

  /**
   * Queue another turn for a note: same worktree, same session, new prompt.
   *
   * The one path by which a note gets a second turn without a second
   * workspace. Steering falls back to it; escalation always uses it.
   */
  private followUp(boardId: string, noteId: string, text: string, role: "user" | "system" = "user"): void {
    const view = this.getView(boardId)
    const note = view?.notes.find((n) => n.id === noteId)
    const agent = note?.agent
    if (!agent) throw new Error("note has no agent assigned")

    const runId = id("run")
    this.emit(event("run.requested", { runId, noteId, agent }))
    this.say(runId, role, text)
    this.queue.push({
      runId,
      noteId,
      boardId,
      agent,
      prompt: text,
      ...(this.worktrees.has(noteId) ? { worktree: this.worktrees.get(noteId)! } : {}),
    })
    void this.pump()
  }

  /**
   * Continue a note whose policy was just raised to full access.
   *
   * Never delivered live, unlike steering. Policy is a spawn-time argument —
   * telling the process that was refused that it may now proceed changes
   * nothing about what its sandbox will allow. It needs a new process.
   *
   * If one is still running it is stopped first, and the follow-up waits for
   * it to exit: two agents in one worktree is not a thing we allow, and a
   * `run.requested` emitted before the old run's `run.finished` would have its
   * status immediately overwritten by it.
   */
  escalate(boardId: string, noteId: string): Delivery {
    // A turn already waiting for a slot would start under the old policy and
    // then collide with this one in the same worktree. Drop it.
    for (const q of this.queue.filter((q) => q.noteId === noteId)) this.cancel(q.runId)

    const live = [...this.live.values()].find((l) => l.noteId === noteId)
    if (live) {
      this.pending.set(noteId, { boardId, text: CONTINUE_WITH_FULL })
      // Not `cancel`, which writes "cancelled by user" — this is not an
      // abandonment, and a transcript that says so would be lying about why
      // the process died.
      this.say(live.runId, "system", "stopping to grant full access — continuing in a new turn")
      live.child.kill("SIGTERM")
      return "queued"
    }
    this.followUp(boardId, noteId, CONTINUE_WITH_FULL, "system")
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

    const fresh = !q.worktree
    const worktree = q.worktree ?? (await createWorktree(view.board.repoPath, q.noteId, note.title))
    this.worktrees.set(q.noteId, worktree)

    if (!fresh) {
      this.say(q.runId, "system", `continuing in ${worktree.branch}`)
    }

    // A fresh worktree has no dependencies, no .env, no caches. Prepare it
    // before the agent arrives, or it will write a test it cannot run.
    if (fresh && view.board.carry?.length) {
      const carried = await carryInto(view.board.repoPath, worktree.path, view.board.carry)
      if (carried.length) this.say(q.runId, "system", `carried in ${carried.join(", ")}`)
    }

    /*
     * `kandy gc` may have taken this checkout's node_modules and caches while
     * the note sat idle. The checkout is real and keeps its work, but it needs
     * its install back before an agent arrives — otherwise that agent writes a
     * test it cannot run. Consumed here, so it reinstalls exactly once.
     */
    const reinstall = !fresh && takeStripped(q.noteId)

    if ((fresh || reinstall) && view.board.setup) {
      this.log.activity(q.runId, "setup", view.board.setup)
      this.say(q.runId, "system", `preparing workspace: ${view.board.setup}`)

      const started = Date.now()
      const result = await runSetup(worktree.path, view.board.setup, (line) => {
        this.log.activity(q.runId, "setup", line)
      })
      const secs = ((Date.now() - started) / 1000).toFixed(1)

      if (!result.ok) {
        // Better to stop here than hand the agent a broken workspace and let
        // it spend ten minutes discovering that itself.
        throw new Error(`setup failed after ${secs}s (exit ${result.code}): ${view.board.setup}`)
      }
      this.say(q.runId, "system", `workspace ready in ${secs}s`)
    }

    /*
     * Resume the agent's session only when continuing in an existing worktree.
     * A fresh worktree means a fresh filesystem, and an agent whose memory
     * disagrees with what's on disk wastes a turn rediscovering that.
     *
     * The same reasoning, one step further: a session id belongs to the tool
     * that issued it. Claude cannot resume Codex's thread and neither can read
     * the other's, so a change of agent is a fresh session by definition — and
     * the previous work has to arrive as a briefing instead.
     */
    // Everything before this run — `run.requested` fires at queue time, so the
    // view already holds the run being started. See priorRuns.
    const past = priorRuns(view.runs, q.noteId, q.runId)
    const handedOver = past.length > 0 && past.at(-1)!.agent !== q.agent
    const prior =
      q.worktree && !handedOver
        ? past.filter((r) => r.agentSessionId).at(-1)?.agentSessionId
        : undefined

    // Anything attached while the note was being written has been waiting in
    // the state dir for a workspace to exist. It exists now, so the files move
    // in and the prompt names them by a path the agent can actually open.
    const attached = adoptStaged(q.noteId, worktree.path)
    if (attached.length) {
      this.say(q.runId, "system", `attached ${attached.map((f) => f.relPath).join(", ")}`)
    }

    const agentId = q.agent
    const policy = note.policy ?? "repo"

    // A prompt channel is opened only when there is both an agent that can be
    // asked and a policy under which anything would be. Under full access
    // nothing is ever refused, so there is nothing to ask about.
    const asking = this.asking
    const ask =
      asking && a.asks && policy !== "full"
        ? openAskChannel(q.runId, asking.port, asking.token)
        : undefined

    // Note pin wins over the board default; neither means the agent's own.
    // Held here rather than on the adapter: `ADAPTERS` is a singleton, so a
    // model stashed by one run's spawn() was read by the next run's parse().
    const model = note.model ?? view.board.models?.[agentId]

    /*
     * Transcripts are fetched only for a handover, and only then.
     *
     * `promptForRun` takes a lookup rather than the frames themselves so that
     * an ordinary run — the overwhelming majority — reads no transcripts at
     * all. That laziness used to come free from a synchronous store; now the
     * log may be across a network, so the decision `promptForRun` would have
     * made is made once out here and the frames are pulled in before the call
     * rather than during it.
     */
    const briefing = handedOver && !q.prompt
    const frames = new Map<string, TranscriptFrame[]>()
    if (briefing) {
      for (const run of past) frames.set(run.id, await this.log.history(run.id))
    }

    /*
     * The board's MCP servers, read from the view on every run and never
     * cached. That is the whole of "applies without a restart": each run
     * spawns a fresh agent, so a server added a minute ago is simply there.
     */
    const servers = view.board.mcp ?? []
    const mcp = a.mcp ? servers : []
    if (servers.length && !a.mcp) {
      this.say(
        q.runId,
        "system",
        `${agentId} cannot use MCP servers, so this board's ${servers.length} ${servers.length === 1 ? "server was" : "servers were"} not given to it`,
      )
    }
    // Only whether each is set — never its value. A server whose token is
    // missing fails deep inside the agent with an auth error that names
    // neither the server nor the variable; this names both, up front.
    const unset = [...new Set(mcp.flatMap(envRefs))].filter((n) => !process.env[n])
    if (unset.length) {
      this.say(
        q.runId,
        "system",
        `not set on this machine: ${unset.join(", ")} — MCP servers that need ${unset.length === 1 ? "it" : "them"} will fail to connect`,
      )
    }

    const opts = {
      cwd: worktree.path,
      prompt:
        (q.prompt ?? promptForRun(note, past, q.agent, (runId) => frames.get(runId) ?? [])) +
        describeAttachments(attached),
      policy,
      ...(ask ? { ask } : {}),
      ...(model ? { model } : {}),
      ...(prior ? { resume: prior } : {}),
      ...(mcp.length ? { mcp } : {}),
    }

    // A capability the agent cannot be given is a reason to say so, not a
    // reason to refuse the run.
    let prepared: { paths: string[]; undo: () => Promise<void> } | undefined
    if (a.prepare && mcp.length) {
      try {
        prepared = await a.prepare(opts)
      } catch (err) {
        this.say(q.runId, "error", `could not give ${agentId} this board's MCP servers: ${err instanceof Error ? err.message : err}`)
      }
    }

    const spec = a.spawn(opts)
    for (const d of spec.declined ?? []) {
      this.say(q.runId, "system", `MCP server ${d.name} was not given to ${agentId}: ${d.reason}`)
    }

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
      ...(ask ? { ask } : {}),
      ...(prepared ? { undo: prepared.undo } : {}),
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

    if (policy === "full") {
      this.say(q.runId, "system", "running with full access — this agent can do anything you can")
    } else if (ask) {
      this.say(q.runId, "system", "repo only — anything else will be put to you as a question")
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

    // Agents whose prompt travels over stdin get it now, and the pipe stays
    // open because it is the same channel steering messages use later.
    //
    // For everyone else the pipe must be closed immediately. Codex takes its
    // prompt as an argument and then blocks on an open stdin forever —
    // "Reading additional input from stdin..." and nothing else, ever. An
    // agent that cannot be steered must not be handed a stdin to wait on.
    if (spec.stdin && child.stdin?.writable) child.stdin.write(spec.stdin)
    if (!a.live) child.stdin?.end()

    this.syncColumn(q.boardId, q.noteId)
    this.consume(q.runId, child, (line) => a.parse(line, model ? { model } : {}), q.agent)

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
    agent: AgentId,
  ): void {
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on("line", (line) => {
        let parsed: ReturnType<typeof parse>
        try {
          parsed = parse(line)
        } catch (err) {
          // A parser bug must not kill a run that is otherwise working.
          this.log.output(runId, "stdout", line)
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
              // One line per call, written when it starts. Adapters that
              // report completion separately would otherwise print every tool
              // twice, which reads like the agent did the work twice.
              if (ev.status !== "completed") {
                this.say(runId, "tool", ev.detail, ev.tool)
                // Also push it as live activity so every card on the board can
                // show what its agent is doing without opening the note.
                this.log.activity(runId, ev.tool, ev.detail)
              }
              if (ev.status !== "started") {
                this.emit(event("run.tool", { runId, tool: ev.tool, status: ev.status }))
              }
              break
            case "usage": {
              // Price it ourselves when the agent only counted tokens, and
              // record which of the two the number is.
              const priced =
                ev.costUsd ?? (ev.usage ? priceUsage(ev.model ?? null, ev.usage) : null)
              const source: CostSource =
                ev.costUsd !== null ? "reported" : priced !== null ? "estimated" : "unpriced"

              this.say(
                runId,
                "system",
                priced !== null && ev.costUsd === null
                  ? `${ev.text} · ≈$${priced.toFixed(4)}`
                  : ev.text,
              )
              this.emit(
                event("run.metrics", {
                  runId,
                  costUsd: priced,
                  tokens: ev.tokens,
                  turns: ev.turns,
                  model: ev.model ?? null,
                  source,
                }),
              )
              break
            }
            case "limits":
              // Account-level, not run-level: recorded against the agent so the
              // sidebar can show it, never written into the transcript.
              recordLimits(agent, { status: ev.status, windows: ev.windows })
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
        if (!line.trim()) continue
        // Raw stderr is kept for debugging but stays out of the transcript —
        // agent CLIs write progress spinners and deprecation notices there,
        // and a transcript full of noise is a transcript nobody reads.
        this.log.output(runId, "stderr", line)
        /*
         * Watched anyway, for one thing.
         *
         * An agent can refuse to authenticate down either pipe: Claude Code
         * reports it as a JSON error on stdout, a CLI that has simply lost its
         * login usually writes to stderr and exits. Checking only the
         * transcript missed the second kind entirely, which a test with a
         * deliberately unauthenticated agent found.
         */
        if (isAuthFailure(line)) {
          const agent = this.live.get(runId)?.agent
          if (agent) recordAuthFailure(agent)
        }
      }
    })
  }

  /**
   * The message for whatever the agent left uncommitted.
   *
   * The note's title and body, because that is what someone already wrote
   * describing this work — the title says what, the body says why. It used to
   * be `kandy: note_m2d904cm893j2fp0`, which says nothing to anyone reading
   * `git log --oneline` — least of all the person who wrote the note. The id
   * is still recorded, as a trailer, where a machine can find it and a human
   * isn't forced to.
   *
   * No footer here, unlike a merge commit: the diff numbers describe the
   * commit this call is about to create, so they cannot be known yet.
   */
  private commitMessage(l: Live): string {
    const note = this.getView(l.boardId)?.notes.find((n) => n.id === l.noteId)
    return composeCommitMessage({
      id: l.noteId,
      title: note?.title ?? "",
      body: note?.body ?? "",
    })
  }

  /**
   * Trailers for this note's commit — empty unless the board opted in.
   *
   * Empty is the default and it has to stay genuinely empty: commitLeftovers
   * passes no `--trailer` flags for an empty list, so a board that never
   * touched this setting gets the identical git command it always got.
   */
  private trailersFor(l: Live): string[] {
    const view = this.getView(l.boardId)
    if (!view?.board.attribution?.commit) return []
    const note = view.notes.find((n) => n.id === l.noteId)
    return commitTrailers({
      noteId: l.noteId,
      runId: l.runId,
      agent: l.agent,
      model: note?.model ?? view.board.models?.[l.agent] ?? null,
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

    // Settle anything this run was waiting on before anything else. A promise
    // held by a dead process never resolves on its own, and a question on the
    // board that nothing is listening to is worse than no question at all.
    this.asking?.permissions.abandon(runId)
    closeAskChannel(l?.ask)

    let error: string | null = null
    let stat: DiffStat = { files: 0, insertions: 0, deletions: 0 }
    // The textual --stat and the diff itself are for the review snapshot, not
    // the event: too big for the log, and gone with the worktree if unsaved.
    let statText = ""
    let diff = ""
    if (l) {
      // Before the commit, always. Whatever `prepare` wrote into the worktree
      // is kandy's plumbing for this run, not the agent's work, and it must
      // be gone before anything decides what the agent changed.
      await l.undo?.().catch((err) => {
        this.say(runId, "error", `could not tidy up after the run: ${err instanceof Error ? err.message : err}`)
      })
      try {
        await commitLeftovers(l.worktree, this.commitMessage(l), this.trailersFor(l))
        ;[stat, statText, diff] = await Promise.all([
          diffNumbers(l.worktree),
          diffStat(l.worktree),
          gitDiff(l.worktree),
        ])
      } catch (err) {
        error = `failed to capture agent output: ${err instanceof Error ? err.message : err}`
        this.say(runId, "error", error)
      }
    }

    const status = signal ? "cancelled" : code === 0 ? "succeeded" : "failed"
    // Whatever was wrong with this agent's sign-in, it plainly is not now.
    if (status === "succeeded" && l) clearAuthFailure(l.agent)
    this.emit(event("run.finished", { runId, noteId, status, exitCode: code, error }))

    if (status === "succeeded" && l) {
      // Snapshot before announcing: deciding the review removes the worktree,
      // and a review that can no longer show its own diff is not a review.
      this.log.saveDiff(noteId, {
        runId,
        branch: l.worktree.branch,
        stat: statText,
        diff,
      })
      this.emit(event("review.opened", { noteId, runId, branch: l.worktree.branch, stat }))
      // A branch may already have a PR — a re-run of a note whose first
      // attempt was pushed, say. Look before offering to open a second one.
      void this.onBranchReady?.(l.boardId, noteId)
    }
    if (l) this.syncColumn(l.boardId, noteId)

    // A continuation held while this run was stopped. Queued only now, so its
    // `run.requested` lands after the `run.finished` above rather than being
    // clobbered by it.
    const held = this.pending.get(noteId)
    if (held) {
      this.pending.delete(noteId)
      try {
        this.followUp(held.boardId, noteId, held.text, "system")
      } catch (err) {
        this.say(runId, "error", err instanceof Error ? err.message : String(err))
      }
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
    this.say(runId, "system", "cancelled by user")
    l.child.kill("SIGTERM")
    return true
  }

  /**
   * A note landed somewhere other than here — a PR was merged on the forge.
   * Clean up after it exactly as a local merge would.
   */
  /**
   * A note's pull request merged: put its checkout away.
   *
   * Used to force-remove the worktree and tell nobody, so uncommitted changes
   * went with it and the note kept naming a directory that was gone. It goes
   * through the same push-then-delete path as a discard now, and says so in
   * the log when it cannot.
   */
  landed(boardId: string, noteId: string): void {
    const wt = this.worktrees.get(noteId)
    const view = this.getView(boardId)
    if (wt && view) {
      void retireWorktree(view.board.repoPath, wt)
        .then((r) => {
          if (r.removed) {
            this.worktrees.delete(noteId)
            this.emit(event("note.reclaimed", { noteId }))
          }
        })
        .catch(() => {})
    }
    this.syncColumn(boardId, noteId)
  }

  /** Where a note's work lives, for diffing and review. */
  worktreeOf(noteId: string): Worktree | undefined {
    return this.worktrees.get(noteId)
  }

  forget(noteId: string): void {
    this.worktrees.delete(noteId)
    this.pending.delete(noteId)
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
          // Not recorded in the log, so a worktree adopted after a restart
          // diffs against its pinned commit until its next run.
          baseBranch: null,
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

    // Fail the orphans FIRST. These runs died with the last daemon; until
    // they are marked, every note they own still reads `running`, and a column
    // sync done at that point files them under Running — leaving a card that
    // says "failed" sitting in the lane for work in flight, which is precisely
    // the lie this method exists to clear up.
    for (const run of view.runs) {
      if (run.status === "running" || run.status === "starting" || run.status === "blocked") {
        this.emit(
          event("run.finished", {
            runId: run.id,
            noteId: run.noteId,
            status: "failed",
            exitCode: null,
            error: INTERRUPTED,
          }),
        )
      }
    }

    // Then put notes back in the lane their status says they belong to. A
    // draft is left wherever the user filed it — that placement is theirs —
    // but a note that ran is describing machine state, and the board must
    // agree with it. Read statuses from the live projection, not the snapshot
    // passed in, which is now one step out of date.
    for (const n of this.getView(view.board.id)?.notes ?? []) {
      if (n.status !== "draft") this.syncColumn(view.board.id, n.id)
    }
  }

  shutdown(): void {
    for (const l of this.live.values()) l.child.kill("SIGTERM")
  }
}
