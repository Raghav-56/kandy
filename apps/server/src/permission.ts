import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  commandOf,
  decide,
  event,
  id,
  kindOf,
  ruleLabel,
  type PermissionAnswer,
  type PermissionRequest,
} from "@kandy/core"
import type { Engine } from "./engine.js"
import type { AskChannel } from "./agents/types.js"
import { STATE_DIR } from "./paths.js"

/**
 * How long a question is allowed to stand before it answers itself.
 *
 * An agent blocked on a question nobody answers is worse than one that was
 * denied: it holds a slot, it looks like work in flight, and it will never
 * finish. Long enough to walk away from a laptop, short enough that a board
 * left overnight is not still pretending.
 */
export const ASK_TIMEOUT_MS = 10 * 60_000

/** What the agent's CLI is handed back. Claude Code's own prompt contract. */
export type PermissionVerdict =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }

type Waiting = {
  requestId: string
  runId: string
  noteId: string
  boardId: string
  req: PermissionRequest
  input: Record<string, unknown>
  settle: (v: PermissionVerdict) => void
  timer: NodeJS.Timeout
  /** Detaches the "the agent stopped listening" watch. */
  release: () => void
}

/**
 * The half of the permission system that has to wait.
 *
 * The decision itself is a pure function in `@kandy/core` — (tool, args,
 * rules) to allow | deny | ask — and is tested without any of this. What lives
 * here is the `ask` case: a promise held open while the question sits on the
 * board, resolved when somebody answers it, and resolved anyway when nobody
 * does.
 */
export class Permissions {
  private waiting = new Map<string, Waiting>()

  constructor(
    private engine: Engine,
    /** Where the run's note lives, so its standing rules can be read. */
    private locate: (runId: string) => { boardId: string; noteId: string } | null,
    private timeoutMs = ASK_TIMEOUT_MS,
  ) {}

  /**
   * Decide one tool call, asking the user if the rules do not already answer
   * it. Resolves only when there is a verdict to hand back to the agent.
   */
  async request(
    runId: string,
    tool: string,
    input: Record<string, unknown>,
    /**
     * Aborted when the agent's connection drops before we answer. A question
     * whose asker has gone is not a question; without this it would sit on the
     * board until it timed out, inviting someone to answer nothing.
     */
    gone?: AbortSignal,
  ): Promise<PermissionVerdict> {
    const where = this.locate(runId)
    if (!where) return { behavior: "deny", message: "kandy no longer knows about this run" }

    const view = this.engine.view(where.boardId)
    const note = view?.notes.find((n) => n.id === where.noteId)
    const req: PermissionRequest = { tool, command: commandOf(tool, input) }

    switch (decide(req, note?.rules ?? [])) {
      case "allow":
        // No `permission` meta: that tag means "refused", and the pane reads
        // it to build the list of things this note was refused.
        this.engine.say(runId, "system", `allowed by a rule on this note: ${req.command}`)
        return { behavior: "allow", updatedInput: input }
      case "deny":
        return { behavior: "deny", message: `Denied by a rule on this note: ${req.command}` }
      case "ask":
        return this.ask(runId, where, req, input, gone)
    }
  }

  private ask(
    runId: string,
    where: { boardId: string; noteId: string },
    req: PermissionRequest,
    input: Record<string, unknown>,
    gone?: AbortSignal,
  ): Promise<PermissionVerdict> {
    const requestId = id("ask")
    return new Promise<PermissionVerdict>((resolve) => {
      const timer = setTimeout(() => this.expire(requestId), this.timeoutMs)
      // Nothing about this question should keep the daemon alive on its own.
      timer.unref?.()

      const onGone = () => this.expire(requestId, "the agent stopped waiting")
      gone?.addEventListener("abort", onGone, { once: true })

      this.waiting.set(requestId, {
        requestId,
        runId,
        noteId: where.noteId,
        boardId: where.boardId,
        req,
        input,
        settle: resolve,
        timer,
        release: () => gone?.removeEventListener("abort", onGone),
      })

      this.engine.say(runId, "system", `${req.tool}: ${req.command}`, "permission")
      this.engine.emit(
        event("run.blocked", {
          runId,
          requestId,
          kind: "permission",
          detail: `${req.tool} — ${req.command}`,
          tool: req.tool,
          command: req.command,
          ask: true,
        }),
      )
    })
  }

  /** Whether anything is waiting on this request id. */
  pending(requestId: string): boolean {
    return this.waiting.has(requestId)
  }

  /**
   * Answer a waiting question.
   *
   * Returns false when there is nothing to answer — the run died, or another
   * client got there first. Answering twice must not be an error: two browser
   * tabs showing the same board is the normal case.
   */
  answer(requestId: string, answer: PermissionAnswer): boolean {
    const w = this.waiting.get(requestId)
    if (!w) return false
    this.close(w)

    // "Don't ask again" is written before the verdict goes back, so the very
    // next tool call in the same turn is already covered by it.
    if (answer.scope === "note" && answer.decision === "allow") {
      const rule = kindOf(w.req)
      if (rule) {
        this.engine.emit(event("note.permission", { noteId: w.noteId, rule }))
        this.engine.say(w.runId, "system", `won't ask again on this note: ${ruleLabel(rule)}`)
      }
    }

    const comment = answer.comment?.trim()
    this.engine.emit(
      event("run.unblocked", {
        runId: w.runId,
        requestId,
        decision: answer.decision,
        ...(comment ? { comment } : {}),
        ...(answer.scope ? { scope: answer.scope } : {}),
      }),
    )
    this.engine.say(
      w.runId,
      "user",
      answer.decision === "allow"
        ? `allowed: ${w.req.command}`
        : comment
          ? `denied: ${w.req.command} — ${comment}`
          : `denied: ${w.req.command}`,
    )

    w.settle(
      answer.decision === "allow"
        ? { behavior: "allow", updatedInput: w.input }
        : {
            // The message is the point of the third option. "No, run the tests
            // with pnpm not npm" is an answer; bare "denied" is not, and an
            // agent given only that reasons its way around the refusal.
            behavior: "deny",
            message: comment
              ? `The user denied this and said: ${comment}`
              : "The user denied this. Do not retry it; find another way or stop and explain what you need.",
          },
    )
    return true
  }

  /**
   * The question stopped being answerable before anyone answered it — the
   * clock ran out, or the agent's connection dropped.
   *
   * Either way it comes off the board and is said out loud. A question left
   * standing after it stopped mattering is worse than no question: somebody
   * will answer it and believe they unblocked something.
   */
  private expire(requestId: string, because?: string): void {
    const w = this.waiting.get(requestId)
    if (!w) return
    this.close(w)

    const mins = Math.round(this.timeoutMs / 60_000)
    const why = because ?? `no answer after ${mins} minute${mins === 1 ? "" : "s"}`
    this.engine.emit(
      event("run.unblocked", { runId: w.runId, requestId, decision: "timeout" }),
    )
    this.engine.say(
      w.runId,
      "system",
      `${why} — refused ${w.req.command}. ` +
        "Nobody was here to decide; the agent was told so rather than left waiting.",
    )
    w.settle({
      behavior: "deny",
      message:
        `Nobody answered this permission request within ${mins} minutes, so it was refused. ` +
        "Do not retry it — say what you needed and stop.",
    })
  }

  /**
   * A run is over. Anything it was waiting on is unanswerable, so settle it
   * here rather than leaving a promise forever.
   *
   * No `run.unblocked` is emitted: nobody decided anything, and writing one
   * would put a decision in the log that no one made. The `run.finished` that
   * follows is what clears these prompts off the board.
   */
  abandon(runId: string): void {
    for (const w of [...this.waiting.values()]) {
      if (w.runId !== runId) continue
      this.close(w)
      w.settle({ behavior: "deny", message: "The run ended before this was answered." })
    }
  }

  private close(w: Waiting): void {
    clearTimeout(w.timer)
    w.release()
    this.waiting.delete(w.requestId)
  }
}

/**
 * Where the agent's own permission prompt is routed.
 *
 * `claude --permission-prompt-tool <mcp tool>` hands the prompt to a tool we
 * provide instead of auto-denying it. So kandy points the agent at a small MCP
 * server of its own — a sidecar process, not an in-process SDK and not a
 * rewrite — and that server calls back into this daemon over the same HTTP API
 * everything else uses.
 *
 * `configPath` is the `--mcp-config` file naming the sidecar and its
 * credentials; `toolName` is the `--permission-prompt-tool` value, in MCP's
 * `mcp__<server>__<tool>` form.
 */
export type { AskChannel } from "./agents/types.js"

/** The MCP server name, and therefore half of the tool name Claude is given. */
const SERVER = "kandy"
export const PROMPT_TOOL = `mcp__${SERVER}__permission_prompt`

const CONFIG_DIR = path.join(STATE_DIR, "ask")

/**
 * Write the per-run MCP config, and return what the adapter needs.
 *
 * Per run rather than per install because it carries a bearer token and a run
 * id: a file that is only useful while one specific agent is alive is a
 * smaller thing to leave lying around than one that is useful forever. 0600,
 * and removed when the run ends.
 */
export function openAskChannel(runId: string, port: number, token: string): AskChannel {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const configPath = path.join(CONFIG_DIR, `${runId}.json`)
  const config = {
    mcpServers: {
      [SERVER]: {
        command: process.execPath,
        args: sidecarArgs(),
        env: {
          KANDY_URL: `http://127.0.0.1:${port}`,
          KANDY_TOKEN: token,
          KANDY_RUN_ID: runId,
        },
      },
    },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
  chmodSync(configPath, 0o600)
  return { configPath, toolName: PROMPT_TOOL }
}

export function closeAskChannel(channel: AskChannel | undefined): void {
  if (channel) rmSync(channel.configPath, { force: true })
}

/**
 * The sidecar beside this module.
 *
 * `.ts` in dev (`node --experimental-strip-types src/cli.ts`) and `.js` from
 * dist — take the extension from whichever copy of this file is running rather
 * than guessing, since guessing wrong fails only at the moment an agent
 * actually needs to ask something.
 */
function sidecarArgs(): string[] {
  const here = fileURLToPath(import.meta.url)
  const ext = path.extname(here)
  const entry = path.join(path.dirname(here), "permission-mcp" + ext)
  return ext === ".ts" ? ["--experimental-strip-types", entry] : [entry]
}
