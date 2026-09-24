import { stripVTControlCharacters } from "node:util"
import type { AgentAdapter } from "./types.js"

// Aider's scripting interface is plain text, not JSON. Formats are defined in
// aider/coders/base_coder.py (show_usage_report and apply_updates).
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?[kKmM]?`
const TOKENS = new RegExp(
  `^Tokens: (${NUMBER}) sent(?:, ${NUMBER} cache (?:write|hit))*, (${NUMBER}) received\\.(?: (Cost: .+))?$`,
)
const COST = /^Cost: \$(\d+(?:\.\d+)?) message, \$\d+(?:\.\d+)? session\.$/

export const aider: AgentAdapter = {
  id: "aider",
  bin: "aider",
  // There is no single login file: providers and local models are configured
  // by aider itself. Do not inspect configuration or credentials here.
  credentials: [],

  spawn({ prompt, policy, model }) {
    return {
      command: "aider",
      args: [
        "--message", prompt,
        "--yes-always",
        "--no-pretty",
        "--no-stream",
        "--no-auto-commits",
        "--no-dirty-commits",
        "--no-check-update",
        "--no-show-release-notes",
        // Aider has no OS sandbox. For repo policy, disable its automatic
        // command paths; file edits still run in the runner's worktree.
        ...(policy === "full" ? [] : [
          "--no-suggest-shell-commands", "--no-auto-lint", "--no-auto-test",
        ]),
        ...(model ? ["--model", model] : []),
      ],
    }
  },

  // Aider has no MCP client. Saying so beats a board of servers that
  // quietly never arrive.
  mcp: false,

  parse(line) {
    const text = stripVTControlCharacters(line).replace(/\r$/, "")
    if (!text.trim()) return []
    const summary = TOKENS.exec(text)
    const cost = COST.exec(summary?.[3] ?? text)
    if (summary || cost) {
      return [{
        kind: "usage",
        text,
        // Only message cost is additive. Session cost is cumulative.
        costUsd: cost ? Number(cost[1]) : null,
        tokens: summary ? count(summary[1]!) + count(summary[2]!) : null,
        turns: summary ? 1 : null,
      }]
    }
    const edit = /^Applied edit to (.+)$/.exec(text)
    if (edit) return [{ kind: "tool", tool: "edit", detail: edit[1]!, status: "completed" }]
    if (/^(?:Error:|litellm\.[\w.]*Error:)/.test(text)) {
      return [{ kind: "error", message: text }]
    }
    // Keep unfamiliar output visible. No synthetic turn_end: aider can make
    // several requests and apply edits after reporting usage; exit ends a run.
    return [{ kind: "text", text }]
  },
}

function count(value: string): number {
  const multiplier = /k$/i.test(value) ? 1_000 : /m$/i.test(value) ? 1_000_000 : 1
  return Math.round(parseFloat(value.replaceAll(",", "")) * multiplier)
}
