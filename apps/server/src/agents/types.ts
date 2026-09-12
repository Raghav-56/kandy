import type { AgentId } from "@kandy/core"

/** What an adapter emits after parsing one line of its CLI's output. */
export type AgentEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; status: "started" | "completed" | "failed" }
  | { kind: "blocked"; requestId: string; detail: string }
  | { kind: "error"; message: string }

export type SpawnOptions = {
  /** The note's worktree. Never the user's actual working tree. */
  cwd: string
  prompt: string
  /** Agent's own session id, to continue a previous run in this worktree. */
  resume?: string
}

export type SpawnSpec = {
  command: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Adapters normalize each CLI's headless output into our event vocabulary.
 * They never touch credentials: the spawned child inherits whatever the user
 * already logged in with. See docs/05-agent-auth.md.
 */
export type AgentAdapter = {
  id: AgentId
  /** Binary to look for on PATH. */
  bin: string
  /** Credential paths, checked for existence only — never read. */
  credentials: string[]
  spawn(opts: SpawnOptions): SpawnSpec
  /** One line of stdout → zero or more events. */
  parse(line: string): AgentEvent[]
}
