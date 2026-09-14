import { homedir } from "node:os"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { AgentAdapter, AgentEvent } from "./types.js"

/** Claude Code's own Keychain item name on macOS. */
const KEYCHAIN_ITEM = "Claude Code-credentials"

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

  spawn({ cwd, prompt, resume, policy, model, ask }) {
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
          ? [
              "--permission-prompts",
              "host",
              "--permission-prompt-tool",
              ask.toolName,
              "--mcp-config",
              ask.configPath,
            ]
          : []),
        ...(model ? ["--model", model] : []),
        ...(resume ? ["--resume", resume] : []),
      ],
      env: { CLAUDE_PROJECT_DIR: cwd },
      stdin: userMessage(prompt),
    }
  },

  live: { encode: userMessage },

  asks: true,

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
          const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
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

      // Advertised rate-limit notices are interleaved into the stream and are
      // not part of the conversation.
      case "rate_limit_event":
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
 * What Claude Code's stored credential says about itself.
 *
 * Only the metadata beside the tokens: when the sign-in dies and which plan it
 * is on. The tokens themselves are never read — kandy has no use for them, and
 * the spawned child already has its own.
 *
 * The Keychain first, and this is the whole subtlety. On macOS Claude Code
 * keeps the live credential in the Keychain and `~/.claude/.credentials.json`
 * is left behind from before it moved, so reading the file reported a sign-in
 * that expired a month ago while the real one was good for another fortnight.
 * A false "expired" is worse than no expiry at all: it sends you to re-login
 * for nothing.
 *
 * `refreshTokenExpiresAt` is the field that matters. The access token expires
 * every few hours and is refreshed silently; it is the refresh token running
 * out that makes you sign in again.
 *
 * Anything unreadable returns null, never a guess. T3 Code declines to probe
 * for this at all — Claude Code's local init succeeds on cached credentials,
 * so their reliable signal is a 401 at run time — which is a fair warning that
 * a cheerful "ready" here is not a promise.
 */
function readClaudeAuth(): { expiresAt: number | null; plan: string | null } | null {
  const raw = keychainCredential() ?? fileCredential()
  if (!raw) return null
  try {
    const oauth = (JSON.parse(raw) as Record<string, any>)?.["claudeAiOauth"]
    if (!oauth) return null
    const exp = oauth["refreshTokenExpiresAt"] ?? oauth["expiresAt"]
    return {
      expiresAt: typeof exp === "number" ? exp : null,
      plan: typeof oauth["subscriptionType"] === "string" ? oauth["subscriptionType"] : null,
    }
  } catch {
    return null
  }
}

/** The live credential on macOS. Silent — no prompt for the user's own item. */
function keychainCredential(): string | null {
  if (process.platform !== "darwin") return null
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_ITEM, "-w"], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    // No item, or it declined to hand it over. Either way we know nothing.
    return null
  }
}

/**
 * The file, which is authoritative on Linux and a relic on macOS.
 *
 * Only consulted when the Keychain gave nothing, so a stale copy can never
 * outvote the credential actually in use.
 */
function fileCredential(): string | null {
  try {
    return readFileSync(path.join(homedir(), ".claude", ".credentials.json"), "utf8")
  } catch {
    return null
  }
}
