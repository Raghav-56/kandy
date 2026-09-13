import type { AgentId } from "./domain.js"
import type { NoteId, RunId } from "./id.js"

/**
 * Whether a tool call runs, is refused, or is put to the user.
 *
 * `ask` is the answer this module exists for. Before it, a refusal was a dead
 * end: the agent was auto-denied, moved on, and the note landed in `blocked`
 * with a command you could read but not approve.
 */
export type PermissionDecision = "allow" | "deny" | "ask"

/**
 * One standing answer, remembered for a note.
 *
 * Per note, never per board: "don't ask me again about `pnpm test`" is a thing
 * someone says while unblocking one run, and a board-wide rule is a bigger
 * decision than that. Boards have `defaultPolicy` for the bigger decision.
 *
 * `pattern` is matched against the request's command with `*` as the only
 * wildcard; `null` means the whole tool, whatever its arguments.
 */
export type PermissionRule = {
  /** Tool name as the agent spells it — `Bash`, `WebFetch`. `*` matches any. */
  tool: string
  pattern: string | null
  decision: "allow" | "deny"
}

/**
 * A tool call, reduced to the two things a decision can be made from.
 *
 * Deliberately not the agent's raw tool input: the rule function has to be a
 * pure function of small values so it can be tested without a socket, a
 * process, or an agent. The edge converts input to a command with `commandOf`,
 * and everything past that point works on this.
 */
export type PermissionRequest = {
  tool: string
  /** The exact command, path or URL. Verbatim — never a paraphrase. */
  command: string
}

/**
 * A question waiting for an answer, and the most urgent thing on a board.
 *
 * Lives in the view rather than in the runner's memory because every client
 * has to be able to see it and any of them may answer it.
 */
export type PermissionPrompt = {
  requestId: string
  runId: RunId
  noteId: NoteId
  tool: string
  command: string
  /**
   * The rule "don't ask again" would add, or `null` when this request cannot
   * be generalised safely — see `kindOf`. A null here is why that option is
   * sometimes absent rather than present and quietly narrower than it reads.
   */
  rule: PermissionRule | null
  askedAt: number
}

/** How the user answered, as the wire spells it. */
export type PermissionAnswer = {
  decision: "allow" | "deny"
  /** `note` also writes a rule; `once` answers this request and nothing else. */
  scope?: "once" | "note"
  /** Sent back to the agent on a denial: "no, use pnpm not npm". */
  comment?: string
}

/**
 * Agents that can be asked at all.
 *
 * Claude Code routes a permission prompt to a tool we provide
 * (`--permission-prompt-tool`), so the question can reach a person and the
 * answer can reach the agent. Codex's non-interactive exec has no equivalent:
 * it decides alone and tells us afterwards. Rather than showing an affordance
 * that silently does nothing, every surface checks this first.
 */
export const ASK_CAPABLE: readonly AgentId[] = ["claude"]

export function canAsk(agent: AgentId | null | undefined): boolean {
  return agent !== null && agent !== undefined && ASK_CAPABLE.includes(agent)
}

/**
 * The decision for one request, given a note's rules.
 *
 * A pure function of (tool, args, rules) — the shape opencode arrived at, and
 * the reason this is testable at all. Deny wins over allow no matter what
 * order the rules are in: the safe direction should not depend on which
 * button someone pressed first.
 */
export function decide(
  req: PermissionRequest,
  rules: readonly PermissionRule[] = [],
): PermissionDecision {
  let allowed = false
  for (const rule of rules) {
    if (!matches(rule, req)) continue
    if (rule.decision === "deny") return "deny"
    allowed = true
  }
  return allowed ? "allow" : "ask"
}

/** Whether one rule covers one request. */
export function matches(rule: PermissionRule, req: PermissionRequest): boolean {
  if (rule.tool !== "*" && rule.tool !== req.tool) return false
  if (rule.pattern === null) return true
  // A prefix rule must never be stretched across a shell operator. `pnpm
  // test*` would otherwise match `pnpm test && rm -rf ~`, which is a different
  // request wearing the first one's clothes.
  if (isChained(req.command)) return false
  return glob(rule.pattern, req.command)
}

/**
 * The rule that "allow this kind of thing, don't ask again" would write.
 *
 * Null when the request cannot be generalised without widening it into
 * something the user did not look at — an empty command, or one chaining
 * several commands together. In that case the only honest options are the
 * other two.
 */
export function kindOf(req: PermissionRequest): PermissionRule | null {
  if (req.tool !== "Bash") {
    // A non-shell tool is its own kind: "let it read files on this note".
    return req.tool ? { tool: req.tool, pattern: null, decision: "allow" } : null
  }
  const command = req.command.trim()
  if (!command || isChained(command)) return null
  return { tool: "Bash", pattern: prefixOf(command) + "*", decision: "allow" }
}

/**
 * How wide a Bash rule should be.
 *
 * `pnpm test` generalises to `pnpm test*` and not to `pnpm*`, because a
 * package manager's subcommands are not one kind of thing — `pnpm test` and
 * `pnpm publish` have nothing in common but the binary. A plain `ls` has no
 * subcommand to keep, so the binary is the whole of it.
 */
const SUBCOMMANDED = new Set([
  "pnpm", "npm", "yarn", "bun", "npx", "git", "cargo", "docker", "make",
  "go", "uv", "pip", "poetry", "deno", "just", "task", "gh", "kubectl",
  "brew", "bundle", "mvn", "gradle", "terraform",
])

function prefixOf(command: string): string {
  const words = command.split(/\s+/)
  const head = words[0] ?? ""
  const second = words[1]
  if (SUBCOMMANDED.has(head) && second && !second.startsWith("-")) return head + " " + second
  return head
}

/**
 * Shell metacharacters that turn one command into several.
 *
 * Anything here means the command is only ever allowed as itself, once.
 */
const CHAINED = /[;&|`\n><]|\$\(/

export function isChained(command: string): boolean {
  return CHAINED.test(command)
}

/** `*` is the only wildcard. Everything else is matched literally. */
function glob(pattern: string, value: string): boolean {
  const literals = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp("^" + literals.join(".*") + "$").test(value)
}

/**
 * What the tool actually wants to do, pulled out of its arguments.
 *
 * The one place the agent's raw tool input is read. Everything downstream —
 * the rule function, the event, the board — works on the string this returns,
 * which is also the string the user is shown. There is deliberately no second
 * rendering: you approve exactly what you read.
 */
export function commandOf(tool: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : null)
  const first =
    str("command") ?? str("file_path") ?? str("path") ?? str("url") ?? str("pattern") ?? null
  if (first !== null) return first
  // Nothing we recognise: show the arguments rather than the tool name alone,
  // since "the agent wants to use WebSearch" is not a question anyone can
  // answer.
  const json = safeJson(obj)
  return json === "{}" || json === "" ? tool : json
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
}

/** How a rule reads in a sentence: `Bash(pnpm test*)`, or just `Read`. */
export function ruleLabel(rule: PermissionRule): string {
  return rule.pattern === null ? rule.tool : rule.tool + "(" + rule.pattern + ")"
}
