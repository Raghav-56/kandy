import { opencodeMcpConfig } from "../capabilities/mcp.js"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { AgentAdapter, AgentEvent } from "./types.js"

/**
 * opencode adapter, written against opencode's own `run` command
 * (packages/opencode/src/cli/cmd/run.ts), which is where the `--format json`
 * wire format is actually defined rather than documented.
 *
 * Every line is one flat object: `{ type, timestamp, sessionID, ...data }`.
 * The emitted types are the complete set — there is no catch-all:
 *
 *   step_start  { part }                      ← a model step began
 *   text        { part: { text } }            ← something the agent said
 *   reasoning   { part: { text } }            ← thinking out loud
 *   tool_use    { part: { tool, state } }     ← only once completed or errored
 *   step_finish { part: { cost, tokens } }    ← money and tokens, per step
 *   error       { error }
 *
 * Three things follow from reading that file rather than trusting the shape:
 *
 * 1. The session id is on *every* line as `sessionID` — camel-cased, unlike
 *    Claude's `session_id` and unlike Codex's `thread_id`. Getting this wrong
 *    is not loud: resume and follow-up runs just quietly stop working.
 *
 * 2. `tool_use` is only emitted once a tool has completed or errored, so there
 *    is no separate "started" frame. The runner writes a tool's line when it
 *    starts, so a finished call is reported as both at once — reported as
 *    completed alone, it never reached the transcript at all.
 *
 * 3. A permission refusal never becomes JSON. opencode prints it to the same
 *    stdout as a plain line — `! permission requested: bash (…); auto-rejecting`
 *    — and carries on. Left unparsed it lands in the transcript as prose and
 *    the note looks like it merely chose not to do the work.
 *
 * opencode computes its own cost from models.dev prices, which is better than
 * anything kandy could derive — when it is non-zero. A subscription or a local
 * model reports 0.00, and 0 is indistinguishable from free, so tokens are
 * always reported alongside and a zero cost is handed back as null for kandy
 * to price rather than recorded as a run that cost nothing.
 */

export const opencode: AgentAdapter = {
  id: "opencode",
  bin: "opencode",
  readAuth: () => readOpencodeAuth(),
  // None required: opencode runs its own free models with no sign-in at all,
  // so installed is ready. auth.json, when there is one, only adds providers.
  credentials: [],

  spawn({ prompt, resume, policy, model, mcp }) {
    return {
      command: "opencode",
      // Inline config merges over the user's own files rather than replacing
      // them. References are rewritten to `{env:NAME}`, which opencode
      // expands itself — the secret never passes through here.
      ...(mcp?.length
        ? { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeMcpConfig(mcp)) } }
        : {}),
      args: [
        "run",
        "--format",
        "json",
        /*
         * opencode's own default is to allow; `--auto` additionally approves
         * anything the user's config marks `ask`. So `repo` is not "ask
         * nobody" — it is "the user's own permission rules stand, and what
         * they wanted to be asked about gets refused and surfaced as blocked".
         * Full access is what overrides their config, and only they can ask
         * for it. Explicit `deny` rules survive either way; opencode enforces
         * those itself.
         */
        ...(policy === "full" ? ["--auto"] : []),
        ...(model ? ["-m", model] : []),
        ...(resume ? ["-s", resume] : []),
        prompt,
      ],
    }
  },

  mcp: true,

  parse(line, run) {
    const text = line.replace(/\r$/, "")
    if (!text.trim()) return []

    let msg: Record<string, any>
    try {
      msg = JSON.parse(text)
    } catch {
      // See (3) above: refusals arrive as prose on the JSON stream.
      const refusal = REFUSAL.exec(text)
      if (refusal) {
        return [{ kind: "blocked", requestId: "", detail: refusal[1]!.trim().slice(0, 600) }]
      }
      return [{ kind: "text", text }]
    }

    const out: AgentEvent[] = []
    if (typeof msg["sessionID"] === "string") {
      out.push({ kind: "session", sessionId: msg["sessionID"] })
    }

    const part = (msg["part"] ?? {}) as Record<string, any>

    switch (msg["type"]) {
      case "text": {
        const said = typeof part["text"] === "string" ? part["text"] : ""
        if (said.trim()) out.push({ kind: "text", text: said })
        break
      }

      case "tool_use":
        out.push(...fromTool(part))
        break

      case "step_finish": {
        const t = (part["tokens"] ?? {}) as Record<string, any>
        const cache = (t["cache"] ?? {}) as Record<string, number>
        const input = num(t["input"])
        const output = num(t["output"])
        const cacheRead = num(cache["read"])
        const cacheWrite = num(cache["write"])
        /*
         * `tokens.reasoning` is reported separately but is already inside
         * `output` for every provider opencode routes to, so it is deliberately
         * left out of both the total and the billed buckets. Adding it would
         * bill thinking twice, and on a reasoning model that is not a rounding
         * error.
         */
        const tokens = input + output + cacheRead + cacheWrite
        const cost = num(part["cost"])

        out.push({
          kind: "usage",
          text: `${tokens.toLocaleString()} tokens`,
          // A real 0.00 means "opencode had no price for this", not "free".
          costUsd: cost > 0 ? cost : null,
          tokens,
          // One step, not one turn — a run is several, and they sum.
          turns: 1,
          model: run?.model ?? configuredModel(),
          usage: { input, output, cacheRead, cacheWrite },
        })
        break
      }

      case "error": {
        const err = (msg["error"] ?? {}) as Record<string, any>
        // opencode's own formatting: the name, unless there is a message under
        // `data`, which is the part a human can act on.
        const message = err["data"]?.["message"] ?? err["name"] ?? "opencode error"
        out.push({ kind: "error", message: String(message) })
        break
      }

      // The agent thinking out loud, and the frame that says a step began.
      // Neither is something anyone reviews a note for.
      case "reasoning":
      case "step_start":
        break
    }
    return out
  },
}

/**
 * The line opencode prints when it declines a permission request.
 *
 * Emitted verbatim by `run.ts` as
 *   `permission requested: <permission> (<patterns>); auto-rejecting`
 * and anchored on that whole phrase, not on the word "permission" — the
 * transcript is full of files and commands that mention permissions, and a
 * loose match turns every one of them into a blocked note.
 */
const REFUSAL = /(permission requested: .*?; auto-rejecting)/

/**
 * A finished tool call.
 *
 * opencode only emits `tool_use` once `state.status` is `completed` or
 * `error`. A success is handed on as started-then-completed, which is how the
 * runner writes one transcript line for it; a failure is a line by itself.
 */
function fromTool(part: Record<string, any>): AgentEvent[] {
  const state = (part["state"] ?? {}) as Record<string, any>
  const tool = NAMES[String(part["tool"] ?? "")] ?? String(part["tool"] ?? "tool")
  const input = (state["input"] ?? {}) as Record<string, any>
  const detail = summarize(input)
  const id = String(part["callID"] ?? part["id"] ?? "")

  if (state["status"] === "error") {
    const why = String(state["error"]?.["message"] ?? state["error"]?.["name"] ?? state["error"] ?? "")
    // A tool that ran and failed is not a tool that was refused. opencode
    // refuses at the permission layer, before the call, and that path prints
    // the prose line handled above — so anything reaching here with an error
    // is a genuine failure unless it says otherwise.
    if (/denied|not permitted|rejected|permission/i.test(why)) {
      return [{ kind: "blocked", requestId: id, detail: (why || detail).slice(0, 600) }]
    }
    return [{ kind: "tool", tool, detail: (detail || why).slice(0, 200), status: "failed" }]
  }

  return [
    { kind: "tool", tool, detail: detail.slice(0, 200), status: "started" },
    { kind: "tool", tool, detail: detail.slice(0, 200), status: "completed" },
  ]
}

/** opencode's tool names, in kandy's vocabulary where the two disagree. */
const NAMES: Record<string, string> = {
  bash: "shell",
  edit: "edit",
  write: "edit",
  patch: "edit",
  read: "read",
  list: "read",
  glob: "search",
  grep: "search",
  webfetch: "search",
}

/** A one-line gloss of a tool call, for the transcript. */
function summarize(input: Record<string, any>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null)
  const first =
    pick("command") ??
    pick("filePath") ??
    pick("file_path") ??
    pick("path") ??
    pick("pattern") ??
    pick("query") ??
    pick("url") ??
    pick("description") ??
    ""
  const short = first.startsWith("/") ? first.split("/").slice(-2).join("/") : first
  return short.replace(/\s+/g, " ")
}

/** `~/.local/share/opencode`, honouring XDG as opencode's own Global.Path does. */
function dataDir(): string {
  const xdg = process.env["XDG_DATA_HOME"]
  return xdg ? path.join(xdg, "opencode") : path.join(homedir(), ".local", "share", "opencode")
}

function authFile(): string {
  return path.join(dataDir(), "auth.json")
}

function configFile(): string {
  const xdg = process.env["XDG_CONFIG_HOME"]
  const base = xdg ? path.join(xdg, "opencode") : path.join(homedir(), ".config", "opencode")
  return path.join(base, "opencode.json")
}

/**
 * Which providers opencode is signed in to, for the plan line — or that it's
 * on its free models alone.
 *
 * Never a reason to call it signed out: opencode's free models need no
 * account, so an expired OAuth grant, or no auth.json at all, still leaves it
 * able to run. Only the provider ids are read; keys and tokens never are.
 */
function readOpencodeAuth(): { expiresAt: number | null; plan: string | null } {
  try {
    const providers = Object.keys(JSON.parse(readFileSync(authFile(), "utf8")) as Record<string, unknown>)
    return { expiresAt: null, plan: providers.length ? providers.join(", ") : "free models" }
  } catch {
    return { expiresAt: null, plan: "free models" }
  }
}

/**
 * The model opencode is configured to run, as `provider/model`.
 *
 * opencode resolves a model from the `--model` flag, then its config, then the
 * last one used, then an internal ranking — so this is only the second of
 * four, and null here means "let opencode decide", not "there is none".
 */
export function configuredModel(): string | null {
  try {
    const cfg = JSON.parse(readFileSync(configFile(), "utf8")) as Record<string, any>
    const model = cfg["model"]
    return typeof model === "string" && model ? model : null
  } catch {
    return null
  }
}

/** A reported number, or zero. Absent buckets are absent, not unknown. */
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
