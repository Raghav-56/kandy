import { homedir } from "node:os"
import path from "node:path"
import type { AgentAdapter, AgentEvent } from "./types.js"

/**
 * Reference adapter.
 *
 * Codex is first because its headless mode is documented, its sandbox flags
 * are explicit, and it carries none of the subscription-OAuth policy
 * ambiguity that Claude Code does. Shape the other adapters toward this one.
 *
 * Known limitation: the session id cannot be pre-assigned, only captured from
 * the stream — so `revise` depends on us seeing the session event before the
 * process exits.
 */
/** A one-line, human-readable gloss of what a tool call is doing. */
function summarize(item: Record<string, unknown> | undefined): string {
  if (!item) return ""
  for (const key of ["command", "path", "file", "query"]) {
    const v = item[key]
    if (typeof v === "string") return v.slice(0, 200)
  }
  return ""
}

export const codex: AgentAdapter = {
  id: "codex",
  bin: "codex",
  credentials: [path.join(homedir(), ".codex", "auth.json")],

  spawn({ cwd, prompt, resume, policy }) {
    const args = resume
      ? ["exec", "resume", resume, "--json", prompt]
      : ["exec", "--json", prompt]
    return {
      command: "codex",
      // workspace-write keeps the agent inside its worktree for file edits;
      // the worktree is the real boundary and this is defence in depth.
      args: [...args, "-s", policy === "full" ? "danger-full-access" : "workspace-write", "-C", cwd],
    }
  },

  parse(line) {
    if (!line.trim()) return []
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      // Not every line is JSON even in --json mode. Surface it as text rather
      // than dropping it — swallowed output is how debugging becomes guesswork.
      return [{ kind: "text", text: line }]
    }

    const out: AgentEvent[] = []
    const type = typeof msg["type"] === "string" ? (msg["type"] as string) : ""

    if (typeof msg["session_id"] === "string") {
      out.push({ kind: "session", sessionId: msg["session_id"] })
    }

    switch (type) {
      case "item.started":
      case "item.completed": {
        const item = msg["item"] as Record<string, unknown> | undefined
        const itemType = item?.["type"]
        if (itemType === "command_execution" || itemType === "file_change") {
          out.push({
            kind: "tool",
            tool: String(itemType),
            detail: summarize(item),
            status: type === "item.started" ? "started" : "completed",
          })
        } else if (typeof item?.["text"] === "string") {
          out.push({ kind: "text", text: item["text"] })
        }
        break
      }
      case "error":
        out.push({ kind: "error", message: String(msg["message"] ?? "unknown error") })
        break
    }
    return out
  },
}
