import { execFile } from "node:child_process"
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
 * One entry today. The shape is here because opencode has the same problem —
 * a provider-agnostic catalogue no table can predict — and will want the same
 * treatment once it is installed anywhere to test against.
 */
const ASK: Record<string, { bin: string; args: string[]; parse: (out: string) => string[] }> = {
  cursor: {
    bin: "cursor-agent",
    args: ["models"],
    /*
     * Lines are `id - Display Name`, under an "Available models" header:
     *
     *   auto - Auto (default)
     *   cursor-grok-4.6-high - Cursor Grok 4.6
     *
     * The id is what `--model` takes; the display name is what the init frame
     * reports back and is useless for anything but reading.
     */
    parse: (out) =>
      out
        .split("\n")
        .map((l) => /^(\S+) - \S/.exec(l.trim())?.[1])
        .filter((id): id is string => Boolean(id)),
  },
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
      const { stdout } = await run_(ask.bin, ask.args, { timeout: 15_000 })
      const ids = ask.parse(stdout)
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
