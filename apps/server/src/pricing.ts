import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/**
 * Prices for agents that report tokens but not money.
 *
 * Claude Code reports `total_cost_usd` directly. Codex reports only a token
 * count, so a dollar figure has to be computed — and the result is an estimate,
 * tracked as such, never presented as a billed amount.
 *
 * The table is LiteLLM's `model_prices_and_context_window.json`, which is what
 * ccusage and t3code both price against. Per-token rates keyed by the exact
 * model string, fetched once a day and cached on disk; a fetch failure falls
 * back to whatever is cached, and having nothing cached means unpriced rather
 * than guessed.
 */
const URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
const TTL_MS = 24 * 60 * 60 * 1000

type Rates = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
}

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const CACHE_DIR = path.join(
  process.env["XDG_CACHE_HOME"] ?? path.join(homedir(), ".cache"),
  "kandy",
)
const CACHE_FILE = path.join(CACHE_DIR, "prices.json")

let table: Record<string, Rates> | null = null
let loading: Promise<void> | null = null

function readCache(): { at: number; data: Record<string, Rates> } | null {
  try {
    if (!existsSync(CACHE_FILE)) return null
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"))
  } catch {
    return null
  }
}

/**
 * Load the table, refreshing at most once a day.
 *
 * Never throws and never blocks a run: pricing a turn is a nicety, and an agent
 * finishing its work must not depend on GitHub being reachable.
 */
export function warmPrices(): Promise<void> {
  if (loading) return loading

  loading = (async () => {
    const cached = readCache()
    if (cached) table = cached.data
    if (cached && Date.now() - cached.at < TTL_MS) return

    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return
      const data = (await res.json()) as Record<string, Rates>
      table = data
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), data }))
    } catch {
      // Offline, rate-limited, whatever. The cache (or nothing) stands.
    }
  })()

  return loading
}

/**
 * Model ids a given agent can plausibly run, newest-looking first.
 *
 * Derived from the price table we already fetch, filtered to the provider that
 * agent talks to. It is a menu, not a guarantee — the agent still rejects one
 * it does not have access to — but it beats asking someone to type an exact
 * model string from memory.
 */
const PROVIDER: Record<string, { prefixes: string[]; exclude: RegExp }> = {
  claude: { prefixes: ["claude-"], exclude: /(instant|-v1|1\.[0-3]|bedrock|vertex)/ },
  codex: { prefixes: ["gpt-", "o1", "o3", "o4"], exclude: /(audio|realtime|search|transcribe|tts|image|embedding|instruct|-16k|vision-preview)/ },
  gemini: { prefixes: ["gemini-"], exclude: /(vision|embedding|tuned)/ },
  grok: { prefixes: ["xai/grok", "grok-"], exclude: /(vision|image)/ },
  cursor: { prefixes: [], exclude: /.^/ },
  opencode: { prefixes: [], exclude: /.^/ },
}

export function modelsFor(agent: string): string[] {
  const rule = PROVIDER[agent]
  if (!table || !rule || rule.prefixes.length === 0) return []

  const names = Object.entries(table)
    .filter(([name, rates]) => {
      if (!rule.prefixes.some((p) => name.startsWith(p))) return false
      if (rule.exclude.test(name)) return false
      // A model with no input price is a table stub, not something to offer.
      return typeof rates.input_cost_per_token === "number"
    })
    .map(([name]) => name)

  // Longest-lived convention across these providers: higher version strings
  // sort later, so reverse gives newest-first without a date to sort on.
  return names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 40)
}

/** Rates for a model, trying the most specific name first. */
function ratesFor(model: string): Rates | null {
  if (!table) return null
  if (table[model]) return table[model]!

  // Providers prefix and version their ids in ways the table does not always
  // mirror — "anthropic/claude-opus-5", "claude-opus-5-20260101".
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model
  if (table[bare]) return table[bare]!

  const undated = bare.replace(/-\d{8}$/, "")
  if (table[undated]) return table[undated]!

  // Last resort: the longest table key that is a prefix of this model. Avoids
  // matching "gpt-5" against "gpt-5.4-codex" the wrong way round.
  let best: { key: string; rates: Rates } | null = null
  for (const [key, rates] of Object.entries(table)) {
    if (!undated.startsWith(key)) continue
    if (!best || key.length > best.key.length) best = { key, rates }
  }
  return best?.rates ?? null
}

/**
 * Cost in USD, or null when the model isn't in the table.
 *
 * Reasoning tokens are already inside `output` for both agents we support, so
 * they are deliberately not billed a second time. A missing cache rate falls
 * back to the input rate rather than to free — the wrong direction to round.
 */
export function priceUsage(model: string | null, usage: Usage): number | null {
  if (!model) return null
  const r = ratesFor(model)
  if (!r) return null

  const input = r.input_cost_per_token ?? 0
  const output = r.output_cost_per_token ?? 0
  const cacheRead = r.cache_read_input_token_cost ?? input
  const cacheWrite = r.cache_creation_input_token_cost ?? input
  if (input === 0 && output === 0) return null

  return (
    usage.input * input +
    usage.output * output +
    usage.cacheRead * cacheRead +
    usage.cacheWrite * cacheWrite
  )
}
