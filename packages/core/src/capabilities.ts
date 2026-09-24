/**
 * What a board's agents can reach beyond the repository: MCP servers.
 *
 * Skills are not here, deliberately. They live in the repository — in
 * `.agents/skills/`, with a lockfile — where the `skills` CLI already puts
 * them and where every agent already looks. That makes git their transport,
 * which is the right one: a skill committed to the repo reaches every
 * worktree, every teammate's runner and every handoff with no help from us.
 *
 * MCP servers have no such home. Each agent keeps its own config in its own
 * dialect, in the user's home directory, so a server configured for Claude is
 * invisible to Codex and a server configured on your laptop is invisible to a
 * teammate. A board is where they can live once and reach every agent.
 *
 * ## Secrets are named, never stored
 *
 * A value may reference an environment variable as `${NAME}` — an API key in
 * an `Authorization` header, a token in a server's env. kandy never expands
 * it. Each agent's own config dialect does, from the environment of the
 * machine the agent actually runs on: Claude reads `${NAME}`, Cursor
 * `${env:NAME}`, opencode `{env:NAME}`, and Codex takes the variable's *name*
 * in `env_vars` and `bearer_token_env_var`.
 *
 * So a board can say `Bearer ${LINEAR_TOKEN}`, travel to a hub and to every
 * teammate, and each person's agent authenticates with their own token. The
 * hub never holds a key, which is a rule it already has for provider logins.
 */
export type McpServer =
  | {
      name: string
      type: "stdio"
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      name: string
      type: "http"
      url: string
      headers?: Record<string, string>
    }

/**
 * Names go into other tools' config keys — a TOML dotted key for Codex, a JSON
 * object key everywhere else — so they are held to the characters every one of
 * those accepts unquoted.
 */
export const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/

/** `${NAME}`, the one reference syntax a board's config may use. */
export const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Every variable a server's config refers to, so a runner can say which are missing. */
export function envRefs(server: McpServer): string[] {
  const values =
    server.type === "stdio"
      ? [server.command, ...(server.args ?? []), ...Object.values(server.env ?? {})]
      : [server.url, ...Object.values(server.headers ?? {})]
  const names = new Set<string>()
  for (const v of values) for (const m of v.matchAll(ENV_REF)) names.add(m[1]!)
  return [...names]
}

/**
 * A server list as it arrived over the wire, checked.
 *
 * Returns the reason for the first problem rather than throwing, because the
 * caller is an HTTP handler that wants to say what is wrong, and a config that
 * is half-applied is worse than one that is refused.
 */
export function checkMcpServers(input: unknown): { ok: true; servers: McpServer[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "servers must be a list" }

  const seen = new Set<string>()
  const servers: McpServer[] = []
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "each server must be an object" }
    const s = raw as Record<string, unknown>

    const name = s["name"]
    if (typeof name !== "string" || !MCP_NAME.test(name)) {
      return { ok: false, error: `name must be letters, digits, - or _ (got ${JSON.stringify(name)})` }
    }
    if (seen.has(name)) return { ok: false, error: `two servers are called ${name}` }
    seen.add(name)

    if (s["type"] === "stdio") {
      if (typeof s["command"] !== "string" || !s["command"].trim()) {
        return { ok: false, error: `${name}: a stdio server needs a command` }
      }
      const args = s["args"]
      if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== "string"))) {
        return { ok: false, error: `${name}: args must be a list of strings` }
      }
      const env = stringMap(s["env"])
      if (env === null) return { ok: false, error: `${name}: env must map names to strings` }
      servers.push({
        name,
        type: "stdio",
        command: s["command"],
        ...(args ? { args: args as string[] } : {}),
        ...(env && Object.keys(env).length ? { env } : {}),
      })
    } else if (s["type"] === "http") {
      if (typeof s["url"] !== "string" || !/^https?:\/\//.test(s["url"])) {
        return { ok: false, error: `${name}: an http server needs an http(s) url` }
      }
      const headers = stringMap(s["headers"])
      if (headers === null) return { ok: false, error: `${name}: headers must map names to strings` }
      servers.push({
        name,
        type: "http",
        url: s["url"],
        ...(headers && Object.keys(headers).length ? { headers } : {}),
      })
    } else {
      return { ok: false, error: `${name}: type must be "stdio" or "http"` }
    }
  }
  return { ok: true, servers }
}

/** undefined when absent, null when present and malformed. */
function stringMap(v: unknown): Record<string, string> | undefined | null {
  if (v === undefined) return undefined
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") return null
    out[k] = val
  }
  return out
}

/** A skill as the board shows it. Read from the repository, never stored in the log. */
export type SkillInfo = {
  name: string
  description: string | null
  /** Where it lives, relative to the repository root. */
  path: string
  /** Where it came from, per `skills-lock.json`, if it says. */
  source: string | null
  /**
   * Whether git knows about it.
   *
   * The one thing kandy adds to what the `skills` CLI reports, and the reason
   * it matters: a worktree is checked out from git, so an uncommitted skill is
   * on your disk and in none of the places an agent actually runs — not a
   * note's worktree, and not a teammate's machine.
   */
  committed: boolean
}
