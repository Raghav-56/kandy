import type { McpServer } from "@kandy/core"
import { berry, bold, dim, faint, lemon, mint } from "./banner.js"
import { boardHere } from "./commands.js"
import { client, ensureUp } from "./daemon.js"

const out = (s = "") => process.stdout.write(s + "\n")

/**
 * `kandy skills` and `kandy mcp` — what a board's agents can reach.
 *
 * Both act on the board for the repository you are standing in, the way
 * every other command does. Neither adopts one: installing a capability into
 * a repository kandy has not been pointed at would be a surprise.
 */

async function board(port: number) {
  if (!(await ensureUp(port))) return null
  const here = await boardHere(port)
  if (!here) out(berry("  no board here") + dim(" — run kandy in this repo once to create one"))
  return here
}

export async function cmdSkills(args: string[], opts: { port: number; skill?: string }): Promise<number> {
  const here = await board(opts.port)
  if (!here) return 1
  const api = client(opts.port)
  const id = here.board.id
  const [verb, arg] = args

  try {
    if (verb === "add") {
      if (!arg) return usage("kandy skills add <owner/repo> [--skill name]")
      out(dim(`  installing ${arg} for every agent…`))
      await api.addSkills(id, arg, opts.skill)
    } else if (verb === "remove" || verb === "rm") {
      if (!arg) return usage("kandy skills remove <name>")
      await api.removeSkill(id, arg)
      out(`  ${mint("removed")} ${bold(arg)}`)
    } else if (verb === "commit") {
      const { committed } = await api.commitSkills(id)
      out(
        committed.length
          ? `  ${mint("committed")} ${committed.map(bold).join(", ")}`
          : dim("  every skill is already committed"),
      )
      return 0
    } else if (verb !== undefined && verb !== "list" && verb !== "ls") {
      return usage("kandy skills [list | add <source> | remove <name> | commit]")
    }
  } catch (err) {
    out(berry(`  ${err instanceof Error ? err.message : String(err)}`))
    return 1
  }

  const { skills } = await api.skills(id)
  if (skills.length === 0) {
    out(dim("  no skills in this repository"))
    out(faint("  kandy skills add <owner/repo>"))
    return 0
  }
  const width = Math.max(...skills.map((s) => s.name.length))
  for (const s of skills) {
    const mark = s.committed ? mint("●") : lemon("○")
    out(`  ${mark} ${bold(s.name.padEnd(width))}  ${faint(s.description?.slice(0, 64) ?? "")}`)
  }
  const loose = skills.filter((s) => !s.committed)
  if (loose.length) {
    // The reason this command exists: said plainly, with the way out.
    out(
      `\n  ${lemon(`${loose.length} not committed`)}${dim(
        " — a note runs in a checkout of git, so no agent kandy starts can see them",
      )}`,
    )
    out(faint("  kandy skills commit"))
  }
  return 0
}

/**
 * `kandy mcp add <name> -- <command> [args…]` for a local server,
 * `kandy mcp add <name> --url <url> [--header "K: V"]` for a remote one.
 *
 * The `--` is not decoration. Everything after it belongs to the server's own
 * command line, where `-y` and `--stdio` are ordinary arguments; before it,
 * they would be kandy flags it does not know.
 */
export async function cmdMcp(
  args: string[],
  opts: { port: number; url?: string; headers: string[]; env: string[]; tail: string[] },
): Promise<number> {
  const here = await board(opts.port)
  if (!here) return 1
  const api = client(opts.port)
  const id = here.board.id
  const current = here.view.board.mcp ?? []
  const [verb, name] = args

  try {
    if (verb === "add") {
      if (!name) return usage('kandy mcp add <name> -- <command> [args…]   |   --url <url> [--header "K: V"]')
      let server: McpServer
      if (opts.url) {
        server = { name, type: "http", url: opts.url, ...pairs(opts.headers, ":", "headers") }
      } else {
        const [command, ...rest] = opts.tail
        if (!command) return usage("kandy mcp add <name> -- <command> [args…]")
        server = {
          name,
          type: "stdio",
          command,
          ...(rest.length ? { args: rest } : {}),
          ...pairs(opts.env, "=", "env"),
        }
      }
      const next = [...current.filter((s) => s.name !== name), server]
      await api.setMcp(id, next)
      out(`  ${mint(current.some((s) => s.name === name) ? "replaced" : "added")} ${bold(name)}`)
      const refs = JSON.stringify(server).match(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g) ?? []
      if (refs.length) {
        out(dim(`  ${[...new Set(refs)].join(", ")} will be read on each machine that runs it, never stored`))
      }
      // A literal secret on a board is a secret in the log, and in every
      // teammate's copy of it once there is a hub. Said, not refused: it is
      // their board. Each value on its own — one ${NAME} doesn't vouch for a
      // pasted token beside it.
      const literal = literalSecrets(opts.url ? opts.headers : [], opts.url ? [] : opts.env)
      if (literal.length) {
        out(lemon(`  ${literal.join(", ")} looks like a literal secret — write it as \${NAME} so it stays on your machine`))
      }
      return 0
    }
    if (verb === "remove" || verb === "rm") {
      if (!name) return usage("kandy mcp remove <name>")
      if (!current.some((s) => s.name === name)) {
        out(berry(`  no server called ${name}`))
        return 1
      }
      await api.setMcp(
        id,
        current.filter((s) => s.name !== name),
      )
      out(`  ${mint("removed")} ${bold(name)}`)
      return 0
    }
    if (verb !== undefined && verb !== "list" && verb !== "ls") {
      return usage("kandy mcp [list | add <name> … | remove <name>]")
    }
  } catch (err) {
    out(berry(`  ${err instanceof Error ? err.message : String(err)}`))
    return 1
  }

  if (current.length === 0) {
    out(dim("  no MCP servers on this board"))
    out(faint("  kandy mcp add github -- npx -y @modelcontextprotocol/server-github"))
    return 0
  }
  for (const s of current) {
    const what = s.type === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")
    out(`  ${bold(s.name)}  ${faint(s.type)}  ${dim(what)}`)
  }
  out(dim("\n  given to Claude, Codex, Cursor and opencode on every run, in each one's own format"))
  return 0
}

/**
 * The names of headers (`K: V`) and env vars (`K=V`) that look like secrets
 * and are written out in full rather than as `${NAME}`.
 */
export function literalSecrets(headers: string[], env: string[]): string[] {
  const secretish = /authorization|token|key|secret|password|passwd|auth|credential|cookie/i
  const found: string[] = []
  for (const [list, sep] of [
    [headers, ":"],
    [env, "="],
  ] as const) {
    for (const item of list) {
      const i = item.indexOf(sep)
      if (i <= 0) continue
      const name = item.slice(0, i).trim()
      const value = item.slice(i + 1).trim()
      if (!value || /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)) continue
      if (secretish.test(name) || /^bearer\s/i.test(value)) found.push(name)
    }
  }
  return found
}

/** `["K: V", …]` → `{ headers: { K: "V" } }`, or nothing when there are none. */
function pairs<K extends string>(list: string[], sep: string, key: K): Partial<Record<K, Record<string, string>>> {
  if (list.length === 0) return {}
  const map: Record<string, string> = {}
  for (const item of list) {
    const i = item.indexOf(sep)
    if (i <= 0) throw new Error(`expected NAME${sep}VALUE, got ${JSON.stringify(item)}`)
    map[item.slice(0, i).trim()] = item.slice(i + 1).trim()
  }
  return { [key]: map } as Partial<Record<K, Record<string, string>>>
}

function usage(line: string): number {
  out(dim("  usage: ") + line)
  return 1
}
