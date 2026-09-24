import { claudeMcpConfig } from "../capabilities/mcp.js"
import { homedir } from "node:os"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { AgentAdapter, AgentEvent } from "./types.js"

/** Claude Code's own Keychain item name on macOS. */

/**
 * Claude Code adapter.
 *
 * Written against real captured output from `claude -p --output-format
 * stream-json --verbose` (v2.1.269), not from docs.
 *
 * Two decisions worth knowing:
 *
 * 1. The prompt goes over stdin, not argv, because `--input-format stream-json`
 *    is what makes steering possible: the same channel takes further user
 *    messages, turn by turn, against the same session.
 *
 * 2. Permission mode follows the note's policy. In headless mode Claude
 *    auto-denies anything it cannot ask about and reports it in
 *    `result.permission_denials`; we surface those rather than letting them
 *    vanish into a transcript nobody reads.
 *
 * 3. …unless there is somewhere to ask. `--permission-prompt-tool` routes the
 *    prompt to an MCP tool of ours instead of auto-denying it, and
 *    `--permission-prompts host` is what decides anything is asked at all
 *    (host is the default; it is passed anyway so a change of default cannot
 *    quietly turn this off). Verified against the installed CLI, not docs —
 *    unknown flags are rejected outright and these two run clean.
 */
export const claude: AgentAdapter = {
  id: "claude",
  bin: "claude",
  readAuth: () => readClaudeAuth(),
  credentials: [
    path.join(homedir(), ".claude", ".credentials.json"),
    // macOS keeps the credential in the Keychain, leaving only this behind.
    path.join(homedir(), ".claude.json"),
  ],

  spawn({ cwd, prompt, resume, policy, model, ask, mcp }) {
    // Claude accepts inline JSON as well as a path, so the board's servers
    // need no file. `${NAME}` references go in as written: Claude expands them
    // from its own environment, which is the point.
    const boardMcp = mcp?.length ? [JSON.stringify(claudeMcpConfig(mcp))] : []
    const askMcp = ask && policy !== "full" ? [ask.configPath] : []
    const mcpConfigs = [...askMcp, ...boardMcp]
    return {
      command: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        // Without --verbose the stream buffers to the end, which defeats the
        // entire point of watching a run.
        "--verbose",
        "--permission-mode",
        // `acceptEdits` lets the agent write files but refuses most Bash —
        // including running the very tests it just wrote. `bypassPermissions`
        // unblocks that, and is the user's explicit choice, never our default.
        policy === "full" ? "bypassPermissions" : "acceptEdits",
        // Echo our own messages back so the transcript shows steering in place.
        "--replay-user-messages",
        // A refusal becomes a question. Only under `repo` — `bypassPermissions`
        // never asks anything, so wiring a prompt tool into it would be a
        // channel nothing ever travels down.
        ...(ask && policy !== "full"
          ? ["--permission-prompts", "host", "--permission-prompt-tool", ask.toolName]
          : []),
        // One flag, every config after it. Additive: without
        // `--strict-mcp-config` the user's own servers still load too.
        ...(mcpConfigs.length ? ["--mcp-config", ...mcpConfigs] : []),
        ...(model ? ["--model", model] : []),
        ...(resume ? ["--resume", resume] : []),
      ],
      env: { CLAUDE_PROJECT_DIR: cwd },
      stdin: userMessage(prompt),
    }
  },

  live: { encode: userMessage },

  asks: true,

  mcp: true,

  parse(line) {
    if (!line.trim()) return []
    let msg: Record<string, any>
    try {
      msg = JSON.parse(line)
    } catch {
      return [{ kind: "text", text: line }]
    }

    const out: AgentEvent[] = []
    if (typeof msg["session_id"] === "string") {
      out.push({ kind: "session", sessionId: msg["session_id"] })
    }

    switch (msg["type"]) {
      case "assistant": {
        for (const block of msg["message"]?.content ?? []) {
          if (block?.type === "text" && block.text?.trim()) {
            out.push({ kind: "text", text: block.text })
          } else if (block?.type === "tool_use") {
            out.push({
              kind: "tool",
              tool: String(block.name ?? "tool"),
              detail: summarize(block.name, block.input),
              status: "started",
            })
          }
        }
        break
      }

      case "user": {
        // Tool results come back threaded as synthetic user messages. We only
        // care about the failures — a transcript of every successful read is
        // noise, but a denial is the thing the user needs to see.
        for (const block of msg["message"]?.content ?? []) {
          if (block?.type === "tool_result" && block.is_error) {
            const text = typeof block.content === "string" ? block.content : "tool failed"
            // Claude phrases refusals several ways — "Permission ... was
            // denied", "requires approval". Matching only the first word
            // silently downgrades a denial into an ordinary tool failure,
            // which is how `blocked` becomes theatre.
            const denial = /permission|requires approval|was denied|not allowed/i.test(text)
            out.push(
              denial
                ? { kind: "blocked", requestId: String(block.tool_use_id ?? ""), detail: text }
                : { kind: "tool", tool: "result", detail: text.slice(0, 400), status: "failed" },
            )
          }
        }
        break
      }

      case "result": {
        const denials = msg["permission_denials"]
        if (Array.isArray(denials)) {
          for (const d of denials) {
            out.push({
              kind: "blocked",
              requestId: String(d?.tool_use_id ?? ""),
              detail: `${d?.tool_name ?? "tool"} — ${summarize(d?.tool_name, d?.tool_input)}`,
            })
          }
        }
        const cost = msg["total_cost_usd"]
        const usage = msg["usage"]
        if (typeof cost === "number") {
          /*
           * Every token the turn processed, cache included.
           *
           * Claude reports `input_tokens` net of cache and puts the cached
           * halves in their own fields, so adding only input and output
           * counted a fraction of the work: the same job that Cursor reported
           * as 2.5M read as 11.8k here, because Cursor's figure includes the
           * context resent on every turn and this one did not.
           *
           * Both are defensible in isolation and together they are nonsense —
           * the usage page was summing four adapters that each meant something
           * different by "tokens". They all mean this now.
           */
          const tokens =
            (usage?.input_tokens ?? 0) +
            (usage?.output_tokens ?? 0) +
            (usage?.cache_creation_input_tokens ?? 0) +
            (usage?.cache_read_input_tokens ?? 0)
          out.push({
            kind: "usage",
            text: `${msg["num_turns"] ?? 1} turn(s) · ${tokens} tokens · $${cost.toFixed(4)}`,
            costUsd: cost,
            tokens,
            turns: typeof msg["num_turns"] === "number" ? msg["num_turns"] : null,
            model: typeof msg["model"] === "string" ? msg["model"] : null,
          })
        }
        if (msg["is_error"]) {
          out.push({ kind: "error", message: String(msg["result"] ?? "run failed") })
        }
        out.push({ kind: "turn_end" })
        break
      }

      /*
       * The subscription's usage windows, reported by Claude Code itself.
       *
       * Interleaved into the stream and not part of the conversation, so they
       * never reach the transcript — but they were being thrown away, and they
       * are the one number a Max subscriber actually watches: how much of the
       * five-hour and weekly allowance is gone, and when it comes back.
       *
       * Captured shape, 2.1.278:
       *   rate_limit_info: { status: "allowed",
       *     unifiedWindows: { five_hour: { utilization: 0.23, resetsAt: 1790079600 },
       *                       seven_day: { utilization: 0.7,  resetsAt: 1790193600 } } }
       * `resetsAt` is epoch seconds.
       */
      case "rate_limit_event": {
        const info = (msg["rate_limit_info"] ?? {}) as Record<string, any>
        const windows = Object.entries((info["unifiedWindows"] ?? {}) as Record<string, any>)
          .filter(([, w]) => typeof w?.utilization === "number")
          .map(([window, w]) => ({
            window,
            used: Math.max(0, Math.min(1, w.utilization as number)),
            resetsAt: typeof w.resetsAt === "number" ? w.resetsAt * 1000 : null,
          }))
        if (windows.length > 0) {
          out.push({ kind: "limits", status: String(info["status"] ?? "allowed"), windows })
        }
        break
      }
      case "system":
        break
    }
    return out
  },
}

/** The stdin wire format for a user turn, verified empirically. */
function userMessage(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n"
  )
}

/** A one-line gloss of a tool call, for the transcript. */
function summarize(name: unknown, input: Record<string, unknown> | undefined): string {
  if (!input) return ""
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null)
  const first =
    pick("command") ??
    pick("file_path") ??
    pick("path") ??
    pick("pattern") ??
    pick("prompt") ??
    pick("description") ??
    ""
  return first.replace(/\s+/g, " ").slice(0, 200) || String(name ?? "")
}

/**
 * Whether anyone is signed in to Claude Code, and on which plan — asked of
 * Claude Code itself.
 *
 * This used to read the Keychain item `Claude Code-credentials` (and on Linux
 * `~/.claude/.credentials.json`) to pull out an expiry date and a plan. Its
 * comment said the tokens were never read; they were — `security
 * find-generic-password -w` returns the whole secret, which *is* the token
 * JSON, so every detection loaded a live OAuth credential into this process to
 * look at two fields beside it.
 *
 * Nothing was ever sent anywhere, but reading another application's credential
 * store is exactly what got opencode's users banned when a community plugin
 * did it to make its own requests. `claude auth status --json` answers the
 * same question the sanctioned way and never touches the token.
 *
 * What it costs: auth status reports no expiry, so there is no "expires in 12
 * days". The runtime auth-failure detection catches a dead sign-in on its
 * first failed run, which is the more honest signal anyway — Claude Code's own
 * init succeeds on cached credentials, so a cheerful "ready" was never a
 * promise.
 *
 * Half a second per call and detection runs on every agents request, so the
 * answer is held for a minute.
 */
const AUTH_TTL_MS = 60_000
let authCache: { at: number; value: ReturnType<typeof askClaudeAuth> } | null = null

function readClaudeAuth(): { expiresAt: number | null; plan: string | null; authed?: boolean } | null {
  if (authCache && Date.now() - authCache.at < AUTH_TTL_MS) return authCache.value
  const value = askClaudeAuth()
  authCache = { at: Date.now(), value }
  return value
}

function askClaudeAuth(): { expiresAt: number | null; plan: string | null; authed?: boolean } | null {
  try {
    const out = execFileSync("claude", ["auth", "status", "--json"], {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const s = JSON.parse(out) as { loggedIn?: unknown; subscriptionType?: unknown }
    return {
      expiresAt: null,
      plan: typeof s.subscriptionType === "string" ? s.subscriptionType : null,
      authed: s.loggedIn === true,
    }
  } catch {
    // Not installed, too old to have `auth status`, or it said something we
    // cannot read. Unknown is not "signed out".
    return null
  }
}
