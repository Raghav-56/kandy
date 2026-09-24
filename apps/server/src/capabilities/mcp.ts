import { ENV_REF, type McpServer } from "@kandy/core"

/**
 * One board's MCP servers, in each agent's own dialect.
 *
 * Every function here is pure and every one is a translation, not a policy:
 * what reaches an agent is decided in the runner, and this only says how to
 * spell it for that agent. Kept apart so the spelling can be tested against
 * each CLI's documented format without spawning one.
 *
 * ## The rule every translation keeps: never expand a secret
 *
 * A board's config names secrets as `${NAME}`. None of these functions ever
 * reads `process.env` — each rewrites the reference into the syntax that
 * agent expands for itself, so the value comes from the environment of the
 * machine the agent runs on and never passes through kandy, a config file on
 * disk, or a process's argv:
 *
 *   Claude     `${NAME}`       — its native syntax, left as written
 *   Cursor     `${env:NAME}`
 *   opencode   `{env:NAME}`
 *   Codex      the *name* in `env_vars`, `bearer_token_env_var`,
 *              `env_http_headers` — it has no substitution syntax at all
 *
 * Codex is the one dialect that cannot say everything the others can, so its
 * translation can decline a server. It says why, rather than dropping it
 * silently or expanding the secret into argv to make it fit.
 */

// ── Claude ────────────────────────────────────────────────────────────────

/**
 * The file `--mcp-config` reads. Claude expands `${NAME}` in command, args,
 * env, url and headers itself, so the board's values go in exactly as written.
 */
export function claudeMcpConfig(servers: readonly McpServer[]): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] =
      s.type === "stdio"
        ? { type: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} }
        : { type: "http", url: s.url, headers: s.headers ?? {} }
  }
  return { mcpServers }
}

// ── Cursor ────────────────────────────────────────────────────────────────

const toCursor = (v: string) => v.replace(ENV_REF, "${env:$1}")

/**
 * `.cursor/mcp.json`, merged over whatever the project already has.
 *
 * Cursor has no flag for this — it reads the project file and
 * `~/.cursor/mcp.json`, the second resolved from `homedir()` directly — so the
 * project file in the worktree is the only route that touches nothing of the
 * user's. The project's own servers are kept; a board server with the same
 * name wins, because the board is the more specific instruction for this run.
 */
export function cursorMcpConfig(
  servers: readonly McpServer[],
  existing: { mcpServers?: Record<string, unknown> } | null = null,
): { mcpServers: Record<string, unknown> } {
  const mcpServers: Record<string, unknown> = { ...(existing?.mcpServers ?? {}) }
  for (const s of servers) {
    mcpServers[s.name] =
      s.type === "stdio"
        ? {
            command: toCursor(s.command),
            args: (s.args ?? []).map(toCursor),
            env: mapValues(s.env ?? {}, toCursor),
          }
        : { url: toCursor(s.url), headers: mapValues(s.headers ?? {}, toCursor) }
  }
  return { ...(existing ?? {}), mcpServers }
}

// ── opencode ──────────────────────────────────────────────────────────────

const toOpencode = (v: string) => v.replace(ENV_REF, "{env:$1}")

/**
 * The `mcp` block for `OPENCODE_CONFIG_CONTENT`.
 *
 * Inline config merges over the user's own files rather than replacing them,
 * per opencode's precedence rules, so nothing they configured is lost. Its
 * local servers take the command and its arguments as one array, and call the
 * environment `environment`.
 */
export function opencodeMcpConfig(servers: readonly McpServer[]): { mcp: Record<string, unknown> } {
  const mcp: Record<string, unknown> = {}
  for (const s of servers) {
    mcp[s.name] =
      s.type === "stdio"
        ? {
            type: "local",
            command: [s.command, ...(s.args ?? [])].map(toOpencode),
            environment: mapValues(s.env ?? {}, toOpencode),
            enabled: true,
          }
        : {
            type: "remote",
            url: toOpencode(s.url),
            headers: mapValues(s.headers ?? {}, toOpencode),
            enabled: true,
          }
  }
  return { mcp }
}

// ── Codex ─────────────────────────────────────────────────────────────────

export type CodexMcp = {
  /** `-c` flags, one per server, each a whole server as a TOML inline table. */
  args: string[]
  /** Servers Codex's config cannot express without expanding a secret, and why. */
  declined: { name: string; reason: string }[]
}

/**
 * `-c mcp_servers.<name>={…}` per server.
 *
 * One inline table per server rather than a flag per field, because Codex
 * parses the value as TOML and an inline table quotes its own keys — a header
 * called `X-Api-Key` needs no special handling. Verified against the real CLI:
 * `codex mcp list -c …` shows these servers alongside the user's own.
 *
 * Codex has no substitution syntax, only fields that take a variable's *name*.
 * So a reference translates only where a named field fits it exactly:
 *
 * - env `KEY: "${KEY}"`                → `env_vars = ["KEY"]`
 * - header `Authorization: "Bearer ${T}"` → `bearer_token_env_var = "T"`
 * - header `H: "${V}"`                 → `env_http_headers = { H = "V" }`
 * - anything with no reference         → literal, as written
 *
 * Anything else — `API_KEY: "${LINEAR_KEY}"`, a reference in an argument, a
 * header that wraps a reference in other text — cannot be said without kandy
 * expanding the secret into argv, where `ps` would show it. Those servers are
 * declined with a reason instead.
 */
export function codexMcpArgs(servers: readonly McpServer[]): CodexMcp {
  const args: string[] = []
  const declined: { name: string; reason: string }[] = []

  for (const s of servers) {
    const fields: string[] = []
    let why: string | null = null

    if (s.type === "stdio") {
      if (hasRef(s.command) || (s.args ?? []).some(hasRef)) {
        why = "Codex cannot substitute a variable into a command or its arguments"
      } else {
        fields.push(`command=${toml(s.command)}`)
        if (s.args?.length) fields.push(`args=[${s.args.map(toml).join(",")}]`)

        const literal: Record<string, string> = {}
        const forwarded: string[] = []
        for (const [k, v] of Object.entries(s.env ?? {})) {
          if (!hasRef(v)) literal[k] = v
          else if (v === `\${${k}}`) forwarded.push(k)
          else {
            why = `Codex can only pass ${k} through under its own name — write it as \${${k}}`
            break
          }
        }
        if (Object.keys(literal).length) fields.push(`env=${inlineTable(literal)}`)
        if (forwarded.length) fields.push(`env_vars=[${forwarded.map(toml).join(",")}]`)
      }
    } else {
      if (hasRef(s.url)) {
        why = "Codex cannot substitute a variable into a url"
      } else {
        fields.push(`url=${toml(s.url)}`)
        const literal: Record<string, string> = {}
        const fromEnv: Record<string, string> = {}
        for (const [h, v] of Object.entries(s.headers ?? {})) {
          const bearer = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(v)
          const whole = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(v)
          if (!hasRef(v)) literal[h] = v
          else if (h.toLowerCase() === "authorization" && bearer) {
            fields.push(`bearer_token_env_var=${toml(bearer[1]!)}`)
          } else if (whole) fromEnv[h] = whole[1]!
          else {
            why = `Codex cannot build the ${h} header around a variable — use the whole value, or Bearer \${NAME}`
            break
          }
        }
        if (Object.keys(literal).length) fields.push(`http_headers=${inlineTable(literal)}`)
        if (Object.keys(fromEnv).length) fields.push(`env_http_headers=${inlineTable(fromEnv)}`)
      }
    }

    if (why) declined.push({ name: s.name, reason: why })
    else args.push("-c", `mcp_servers.${s.name}={${fields.join(", ")}}`)
  }

  return { args, declined }
}

// ── helpers ───────────────────────────────────────────────────────────────

function hasRef(v: string): boolean {
  // A fresh regex: ENV_REF is global and `test` on a global regex is stateful.
  return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(v)
}

/**
 * A TOML basic string. JSON's string escapes are a subset TOML accepts, and
 * `JSON.stringify` never emits the one it does not (`\/`).
 */
function toml(v: string): string {
  return JSON.stringify(v)
}

/** `{ "K" = "v", … }` — keys quoted, so any header name survives. */
function inlineTable(m: Record<string, string>): string {
  return `{${Object.entries(m)
    .map(([k, v]) => `${toml(k)}=${toml(v)}`)
    .join(", ")}}`
}

function mapValues(m: Record<string, string>, f: (v: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f(v)]))
}
