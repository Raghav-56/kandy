import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { AgentAdapter, AgentEvent } from "./types.js"

/**
 * Codex adapter, written against real captured `codex exec --json` output
 * (codex-cli 0.154.0), not docs.
 *
 * Codex speaks a thread/turn/item vocabulary, not Claude's message vocabulary:
 *
 *   thread.started   { thread_id }              ← the session id, for resume
 *   turn.started     {}
 *   item.started     { item: { type, ... } }    ← command_execution, file_change…
 *   item.completed   { item: { type, ... } }
 *   turn.completed   { usage: { input_tokens, output_tokens, … } }
 *
 * Two things this got wrong before, both silent:
 *
 * 1. We looked for `session_id`, which Codex never emits. Session capture
 *    therefore always failed, which meant resume and steering quietly did
 *    nothing for Codex notes.
 * 2. Usage was never read at all, so Codex runs reported no tokens and no
 *    turns — and the board's total spend was Claude-only while looking
 *    complete.
 *
 * Codex reports tokens but not money, so cost stays null rather than being
 * invented from a price list that would be wrong the week it changed.
 */
/** Set by spawn(), read by parse() — the model this process was told to use. */
let pinnedModel: string | undefined

export const codex: AgentAdapter = {
  id: "codex",
  bin: "codex",
  credentials: [path.join(homedir(), ".codex", "auth.json")],

  spawn({ cwd, prompt, resume, policy, model }) {
    const full = policy === "full"
    pinnedModel = model

    // `exec` and `exec resume` do NOT take the same flags: resume accepts
    // neither -s nor -C, and passing them fails the run outright with
    // "unexpected argument '-s' found". Sandboxing is expressed as a config
    // override there instead. The working directory needs neither, since the
    // child is already spawned with the worktree as its cwd.
    if (resume) {
      return {
        command: "codex",
        args: [
          "exec",
          "resume",
          resume,
          "--json",
          ...(full
            ? ["--dangerously-bypass-approvals-and-sandbox"]
            : ["-c", 'sandbox_mode="workspace-write"']),
          ...(model ? ["-m", model] : []),
          prompt,
        ],
      }
    }

    return {
      command: "codex",
      args: [
        "exec",
        "--json",
        // workspace-write keeps edits inside the worktree; the worktree is the
        // real boundary and this is defence in depth.
        "-s",
        full ? "danger-full-access" : "workspace-write",
        "-C",
        cwd,
        ...(model ? ["-m", model] : []),
        prompt,
      ],
    }
  },

  parse(line) {
    // `spawn` records what it was told to run so `turn.completed` can price
    // against the model that actually ran rather than the configured default.
    if (!line.trim()) return []
    let msg: Record<string, any>
    try {
      msg = JSON.parse(line)
    } catch {
      return [{ kind: "text", text: line }]
    }

    const out: AgentEvent[] = []

    switch (msg["type"]) {
      case "thread.started": {
        const id = msg["thread_id"]
        if (typeof id === "string") out.push({ kind: "session", sessionId: id })
        break
      }

      case "item.started":
      case "item.completed": {
        const item = msg["item"] as Record<string, any> | undefined
        if (item) out.push(...fromItem(item, msg["type"] === "item.started"))
        break
      }

      case "turn.completed": {
        const u = (msg["usage"] ?? {}) as Record<string, number>
        const cacheRead = u["cached_input_tokens"] ?? 0
        const cacheWrite = u["cache_write_input_tokens"] ?? 0
        // Codex's input_tokens includes the cached buckets; back them out so
        // each is billed at its own rate rather than twice.
        const input = Math.max(0, (u["input_tokens"] ?? 0) - cacheRead - cacheWrite)
        const output = u["output_tokens"] ?? 0
        const tokens = (u["input_tokens"] ?? 0) + output

        out.push({
          kind: "usage",
          text: `${tokens.toLocaleString()} tokens`,
          // Codex reports no dollar figure; kandy prices it from the tokens.
          costUsd: null,
          tokens,
          turns: 1,
          model: pinnedModel ?? activeModel(),
          usage: { input, output, cacheRead, cacheWrite },
        })
        out.push({ kind: "turn_end" })
        break
      }

      case "turn.failed": {
        const err = msg["error"] as Record<string, any> | undefined
        out.push({ kind: "error", message: String(err?.["message"] ?? "turn failed") })
        out.push({ kind: "turn_end" })
        break
      }

      case "thread.error":
      case "error":
        out.push({ kind: "error", message: String(msg["message"] ?? "codex error") })
        break
    }
    return out
  },
}

/**
 * Wording Codex uses when it declines to run something, as opposed to running
 * it and failing. Anchored deliberately: a loose match turns every file that
 * mentions permissions into a blocked note.
 */
const REFUSAL = /requires approval|not permitted|operation not permitted|sandbox denied|approval required/i

/**
 * Codex emits operational notices as `error` items — hook-trust warnings, a
 * note that skill descriptions were truncated. They are not failures, and
 * painting them red teaches people to ignore red.
 */
const BENIGN = /bypass-hook-trust|skill descriptions were shortened|descriptions are shorter/i

function fromItem(item: Record<string, any>, started: boolean): AgentEvent[] {
  const status: "started" | "completed" = started ? "started" : "completed"

  switch (item["type"]) {
    case "agent_message": {
      // Only on completion — the started event carries no text yet.
      const text = typeof item["text"] === "string" ? item["text"] : ""
      return !started && text.trim() ? [{ kind: "text", text }] : []
    }

    case "command_execution": {
      const cmd = String(item["command"] ?? "")
      const output = String(item["aggregated_output"] ?? "")
      const exit = item["exit_code"]

      // A refusal is a command that did NOT run. Matching on output text alone
      // was a false-positive machine: `cat docs/05-agent-auth.md` marked a note
      // blocked because the document it printed discusses permissions. Require
      // an actual failure first, and keep the phrasing tight.
      const failed = typeof exit === "number" && exit !== 0
      if (!started && failed && REFUSAL.test(output)) {
        return [
          { kind: "blocked", requestId: String(item["id"] ?? ""), detail: output.slice(0, 600) },
        ]
      }
      if (!started && failed) {
        return [{ kind: "tool", tool: "shell", detail: cmd.slice(0, 200), status: "failed" }]
      }
      return [{ kind: "tool", tool: "shell", detail: cmd.replace(/\s+/g, " ").slice(0, 200), status }]
    }

    case "file_change": {
      const changes = Array.isArray(item["changes"]) ? item["changes"] : []
      const paths = changes
        .map((c: Record<string, any>) => String(c["path"] ?? ""))
        .filter(Boolean)
        .map((p: string) => p.split("/").slice(-2).join("/"))
      return [{ kind: "tool", tool: "edit", detail: paths.join(", ").slice(0, 200), status }]
    }

    case "mcp_tool_call":
      return [
        {
          kind: "tool",
          tool: String(item["server"] ?? "mcp"),
          detail: String(item["tool"] ?? ""),
          status,
        },
      ]

    case "web_search":
      return [{ kind: "tool", tool: "search", detail: String(item["query"] ?? ""), status }]

    case "error": {
      if (started) return []
      const message = String(item["message"] ?? "error")
      return BENIGN.test(message)
        ? [{ kind: "usage", text: message, costUsd: null, tokens: null, turns: null }]
        : [{ kind: "error", message }]
    }

    // Reasoning summaries and todo lists are the agent thinking out loud.
    // Useful in a terminal, noise in a transcript someone reviews later.
    case "reasoning":
    case "todo_list":
      return []

    default:
      return []
  }
}

/**
 * Which model Codex will actually use.
 *
 * `codex exec --json` never says — the model only appears on `turn_context`
 * lines in the rollout files, which we do not read. We never pass `-m`, so the
 * configured default is what runs. Cached, because this is consulted on every
 * finished turn and the file does not change mid-run.
 */
let cachedModel: string | null | undefined
function activeModel(): string | null {
  if (cachedModel !== undefined) return cachedModel
  try {
    const cfg = readFileSync(path.join(homedir(), ".codex", "config.toml"), "utf8")
    cachedModel = cfg.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null
  } catch {
    cachedModel = null
  }
  return cachedModel
}
