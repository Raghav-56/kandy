import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

// execFile, not exec: no shell, and the args below are constants either way.
const run_ = promisify(execFile)

/**
 * The models an account may actually run, asked of the CLI that knows.
 *
 * Most agents can be offered a menu derived from the price table, because they
 * run public models under public names. Cursor cannot: its ids are its own —
 * `cursor-grok-4.6-high`, `claude-opus-5-thinking-high`, `composer-2.5` —
 * they appear in no price table, and which of them you may run depends on your
 * plan. Until now kandy offered `auto` plus whatever the config file mentioned
 * and left you to type the rest from memory, which is not a menu.
 *
 * `cursor-agent models` answers it exactly, for this account, and on this
 * machine returns forty-odd entries. It costs a process and a network round
 * trip, so it is asked once an hour and never on the path of anything a person
 * is waiting on: a failure leaves the old menu in place rather than emptying
 * it.
 *
 * Codex is asked a different way and answers better: its app-server speaks
 * JSON-RPC and `model/list` returns real objects — id, display name, a hidden
 * flag, and the reasoning efforts *that model* supports. The hardcoded menu it
 * replaces was not merely inelegant, it was wrong: it offered gpt-5.3-codex,
 * gpt-5.1-codex-mini and gpt-5-codex, none of which this account lists, and
 * omitted gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna and gpt-5.5, all of which
 * it has.
 *
 * Deliberately not stored on the adapter. Adapters are singletons shared by
 * every run, and the last thing removed from them was module state that
 * crossed wires between concurrent runs. This is account-level and identical
 * for all of them, which is the kind of global that is allowed to be one.
 */

const TTL_MS = 60 * 60 * 1000

const CACHE = new Map<string, { at: number; ids: string[] }>()
const INFLIGHT = new Map<string, Promise<void>>()

/**
 * How each CLI is asked, and how its answer is read.
 *
 * opencode is asked too: `opencode models` lists what this machine can run,
 * which with no sign-in at all is opencode's own free models — the menu
 * someone without a subscription needs, and one no table could predict.
 */
type Asker = { ask: () => Promise<string[]> }

/**
 * Codex's app-server, asked once and shut down.
 *
 * JSON-RPC over stdio: initialize, then `model/list`. Hidden models are
 * dropped — the flag exists because Codex does not want them in a picker
 * either. stderr is ignored on purpose: a stale token makes it shout about
 * refresh failures while still answering from cache, and an answer is an
 * answer.
 */
function askCodex(): Promise<string[]> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ids: string[]) => {
      if (done) return
      done = true
      child.kill()
      resolve(ids)
    }

    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] })
    child.on("error", () => finish([]))

    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + "\n")
    let buf = ""
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        let msg: { id?: number; result?: { data?: { id?: string; hidden?: boolean }[] } }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) send({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} })
        if (msg.id === 2) {
          finish(
            (msg.result?.data ?? [])
              .filter((m) => m.hidden !== true && typeof m.id === "string")
              .map((m) => m.id as string),
          )
        }
      }
    })

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "kandy", version: "0" } },
    })
    setTimeout(() => finish([]), 15_000)
  })
}

const ASK: Record<string, Asker> = {
  codex: { ask: askCodex },
  opencode: {
    ask: async () => {
      const { stdout } = await run_("opencode", ["models"], { timeout: 15_000 })
      return parseOpencodeModels(stdout)
    },
  },
  cursor: {
    ask: async () => {
      const { stdout } = await run_("cursor-agent", ["models"], { timeout: 15_000 })
      return parseCursorModels(stdout)
    },
  },
}

/**
 * Cursor's own format.
 *
 * Lines are `id - Display Name`, under an "Available models" header:
 *
 *   auto - Auto (default)
 *   cursor-grok-4.6-high - Cursor Grok 4.6
 *
 * The id is what `--model` takes; the display name is what the init frame
 * reports back and is useless for anything but reading.
 */
export function parseCursorModels(out: string): string[] {
  return out
    .split("\n")
    .map((l) => /^(\S+) - \S/.exec(l.trim())?.[1])
    .filter((id): id is string => Boolean(id))
}

/**
 * opencode's: one `provider/model` per line, the form `-m` takes. Anything
 * else — a log line, a warning — is not a model.
 */
export function parseOpencodeModels(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/\S+$/.test(l))
}

/** Ask the CLI, at most once an hour, and never twice at the same time. */
export function warmCatalogue(agent: string): Promise<void> {
  const ask = ASK[agent]
  if (!ask) return Promise.resolve()

  const held = CACHE.get(agent)
  if (held && Date.now() - held.at < TTL_MS) return Promise.resolve()

  const already = INFLIGHT.get(agent)
  if (already) return already

  const run = (async () => {
    try {
      const ids = await ask.ask()
      // An empty answer is a failed answer. A CLI that is signed out prints a
      // banner and exits zero, and replacing a good menu with nothing is worse
      // than serving one an hour stale.
      if (ids.length > 0) CACHE.set(agent, { at: Date.now(), ids })
    } catch {
      // Not installed, not signed in, offline. The caller falls back.
    } finally {
      INFLIGHT.delete(agent)
    }
  })()

  INFLIGHT.set(agent, run)
  return run
}

/** What the last successful ask returned, or nothing. */
export function catalogued(agent: string): string[] {
  return CACHE.get(agent)?.ids ?? []
}
