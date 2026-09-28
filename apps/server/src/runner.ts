import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import {
  AGENT_NAMES,
  between,
  event,
  id,
  promptFor,
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
import { closeAskChannel, openAskChannel } from "./permission.js"
import { adapter } from "./agents/index.js"
import { resolveCommand } from "./agents/command.js"
import { notInstalled } from "./agents/hints.js"
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
  continueBranch,
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
  /** When the agent last wrote anything at all, on stdout or stderr. */
  lastHeard: number
  /** Tools it said it started and hasn't said finished. */
  openTools: number
  /** Set once the silence is long enough to tell people about. */
  quietSince: number | null
  /** Stopped for saying nothing for far too long; see STALL_MS. */
  silent?: boolean
}

/*
 * An agent that goes quiet, as T3 Code and Vibe Kanban handle it: mostly by
 * leaving it to a person. Vibe Kanban never times a run out; T3 Code gives its
 * one watched agent ten minutes without progress, thirty while a tool is
 * running, and pauses the clock while it waits on the user.
 *
 * So kandy warns early and stops late. After QUIET_MS without a byte the note
 * says so, with a Stop beside it — it may be a rate-limited model, or a build
 * that prints nothing. Only after STALL_MS (STALL_TOOL_MS while a tool it
 * started is still running) is it stopped for you, failed with the reason, to
 * retry. Any output resets both, and a question waiting on you stops the clock.
 */
const ms = (name: string, fallback: number) => Number(process.env[name]) || fallback
export const QUIET_MS = ms("KANDY_QUIET_MS", 2 * 60_000)
export const STALL_MS = ms("KANDY_STALL_MS", 10 * 60_000)
export const STALL_TOOL_MS = ms("KANDY_STALL_TOOL_MS", 30 * 60_000)

/** "45s", "10 min" — for saying how long something was quiet. */
function span(t: number): string {
  return t < 60_000 ? `${Math.round(t / 1000)}s` : `${Math.round(t / 60_000)} min`
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
    private asking?: {
      /**
       * Where the sidecar sends its question: this daemon on `kandy serve`,
       * the hub on a runner. Either way the question is put to a person and
       * the answer comes back down the same request.
       */
      url: string
      /** Empty on a tailnet, where Tailscale says whose machine is asking. */
      token: string
      /** Settle a dead run's questions. Absent on a runner: the hub does it on `run.finished`. */
      abandon?: (runId: string) => void
    },
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
  /** The session id each live run last reported, so it is logged once. */
  private sessions = new Map<string, string>()

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
        // Failed before it ever ran: the card belongs with the failures, not
        // in the lane for work in flight.
        this.syncColumn(next.boardId, next.noteId)
      }
    }
  }

  private async start(q: Queued): Promise<void> {
    const a = adapter(q.agent)
    if (!a) throw new Error(`no adapter for agent "${q.agent}"`)

    const view = this.getView(q.boardId)
    const note = view?.notes.find((n) => n.id === q.noteId)
    if (!view || !note) throw new Error(`note ${q.noteId} not found`)

    /*
     * Where this run works: its own checkout if it has one, the branch it was
     * handed if someone else started it, a new one otherwise.
     *
     * A handed-over note must continue the branch it came with. Starting a
     * fresh one would put this machine's agent beside the work instead of on
     * top of it, and the next review would show half the note.
     */
    const fresh = !q.worktree
    const handedFrom = !q.worktree && note.handoff ? note.handoff : null
    const lastBase = priorRuns(view.runs, q.noteId, q.runId).at(-1)?.baseRef ?? null
    const worktree =
      q.worktree ??
      (handedFrom ? await continueBranch(view.board.repoPath, q.noteId, handedFrom.branch, lastBase) : null) ??
      (await createWorktree(view.board.repoPath, q.noteId, note.title))
    this.worktrees.set(q.noteId, worktree)
    if (handedFrom) {
      this.say(
        q.runId,
        "system",
        worktree.branch === handedFrom.branch
          ? `picked up ${worktree.branch}${handedFrom.by ? `, handed over by ${handedFrom.by}` : ""}`
          : `could not find ${handedFrom.branch} on the remote — starting fresh`,
      )
    }

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
    // A different agent cannot resume another's session, and nor can the same
    // agent on a different machine: the session is on someone else's laptop.
    // Either way the work arrives as a briefing.
    const handedOver = past.length > 0 && (past.at(-1)!.agent !== q.agent || handedFrom !== null)
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
        ? openAskChannel(q.runId, asking.url, asking.token)
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

    const task = q.prompt ?? promptForRun(note, past, q.agent, (runId) => frames.get(runId) ?? [])
    /*
     * Said, not just done. An agent that does not echo its prompt — Cursor,
     * Codex — would otherwise leave no trace that it was briefed at all, and
     * "why did it start by reading the diff?" deserves an answer on the page.
     */
    if (briefing && task !== promptFor(note)) {
      const who = [...new Set(past.map((r) => AGENT_NAMES[r.agent] ?? r.agent))].join(" and ")
      this.say(q.runId, "system", `briefed on ${past.length} earlier run${past.length === 1 ? "" : "s"} by ${who}`)
    }

    const opts = {
      cwd: worktree.path,
      prompt: task + describeAttachments(attached),
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

    const cmd = resolveCommand(spec.command, spec.args)
    const child = spawn(cmd.command, cmd.args, {
      cwd: worktree.path,
      // The child inherits the user's existing CLI credentials. We never read,
      // store, or forward a token ourselves.
      // PWD too: opencode takes its directory from $PWD rather than the
      // process's own, and the daemon's is wherever it was started — so an
      // inherited PWD had it editing that checkout instead of the note's.
      env: { ...process.env, ...spec.env, PWD: worktree.path },
      // stdin stays open: it is how steering reaches agents that accept it.
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: cmd.windowsVerbatimArguments ?? false,
    })

    /*
     * Listened for before anything else can happen, and before any await.
     *
     * A binary that isn't there makes spawn emit 'error' on the next tick, and
     * an 'error' with no listener is thrown — it took the whole daemon down,
     * and every other note's agent with it, because `aider` was not installed.
     */
    const failedToStart = new Promise<NodeJS.ErrnoException>((resolve) => child.once("error", resolve))
    child.on("error", (err) => {
      if (child.pid !== undefined) this.say(q.runId, "error", err.message)
    })
    // No pid means no process: nothing will ever exit, so fail the run here.
    // pump() turns the throw into a failed run with this as its reason.
    if (child.pid === undefined) {
      const err = await failedToStart
      closeAskChannel(ask)
      await prepared?.undo().catch(() => {})
      throw new Error(
        err.code === "ENOENT"
          ? notInstalled(agentId)
          : `could not start ${agentId}: ${err.message}`,
      )
    }

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
      lastHeard: Date.now(),
      openTools: 0,
      quietSince: null,
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

    const heard = () => this.heard(q.runId)
    child.stdout?.on("data", heard)
    child.stderr?.on("data", heard)
    const watch = setInterval(() => this.watch(q.runId), Math.min(15_000, QUIET_MS / 4))
    watch.unref?.()

    child.on("exit", (code, signal) => {
      clearInterval(watch)
      void this.finish(q.runId, q.noteId, code, signal)
    })
  }

  /** The agent wrote something: it's alive, whatever it said. */
  private heard(runId: string): void {
    const l = this.live.get(runId)
    if (!l) return
    l.lastHeard = Date.now()
    if (l.quietSince !== null) {
      l.quietSince = null
      this.emit(event("run.quiet", { runId, since: null }))
    }
  }

  /** How long it's been quiet, and whether that's worth a word or a stop. */
  private watch(runId: string): void {
    const l = this.live.get(runId)
    if (!l || l.silent) return
    const now = Date.now()
    // Waiting on a person isn't being stuck. The clock starts again from the
    // answer, not from the question.
    if (this.getView(l.boardId)?.prompts.some((p) => p.runId === runId)) {
      l.lastHeard = now
      return
    }
    const quiet = now - l.lastHeard
    if (quiet >= QUIET_MS && l.quietSince === null) {
      l.quietSince = l.lastHeard
      this.emit(event("run.quiet", { runId, since: l.lastHeard }))
    }
    const limit = l.openTools > 0 ? STALL_TOOL_MS : STALL_MS
    if (quiet >= limit) {
      l.silent = true
      this.say(
        runId,
        "error",
        `${l.agent} said nothing for ${span(quiet)}, so kandy stopped it — often a model that's ` +
          `rate-limited or unreachable. Retry, or pick another model.`,
      )
      l.child.kill("SIGTERM")
    }
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
              // Claude repeats its session id on every line of its stream.
              // Once is a fact worth logging; every line is noise in the log
              // and, with a hub, a network write each.
              if (this.sessions.get(runId) === ev.sessionId) break
              this.sessions.set(runId, ev.sessionId)
              this.emit(event("run.session", { runId, agentSessionId: ev.sessionId }))
              break
            case "text":
              if (ev.text.trim()) this.say(runId, "assistant", ev.text)
              break
            case "tool": {
              // Open tools get the longer leash: a quiet test suite is working.
              const open = this.live.get(runId)
              if (open) open.openTools = Math.max(0, open.openTools + (ev.status === "started" ? 1 : -1))
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
            }
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
    this.sessions.delete(runId)

    // Settle anything this run was waiting on before anything else. A promise
    // held by a dead process never resolves on its own, and a question on the
    // board that nothing is listening to is worse than no question at all.
    this.asking?.abandon?.(runId)
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

    // Stopped for silence is a failure, not something the user cancelled.
    const status = l?.silent ? "failed" : signal ? "cancelled" : code === 0 ? "succeeded" : "failed"
    if (l?.silent && !error) error = `${l.agent} went quiet and was stopped`
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
  /** Whether this note has a run here now, or one waiting for a slot. */
  isRunning(noteId: string): boolean {
    return [...this.live.values()].some((l) => l.noteId === noteId) || this.queue.some((q) => q.noteId === noteId)
  }

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
