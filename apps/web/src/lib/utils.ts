import { createCn } from "cn/config"

/**
 * `cn`, taught kandy's type scale.
 *
 * The class merger knows Tailwind's own font sizes — `text-xs`, `text-sm` —
 * and nothing about `--text-*` tokens added in `@theme`. Faced with
 * `text-meta text-muted-foreground` it read both as colours and kept only the
 * last, so the size was silently deleted and the text fell back to whatever it
 * inherited. Reversed, the colour was deleted instead.
 *
 * Which quietly undid the type scale wherever a size met a colour inside a
 * `cn()` call. Found because the sidebar footer's "3 agents ready" measured
 * 14px against the 11px its class asked for.
 *
 * Every size the scale defines is listed here. Add one to `styles.css`, add it
 * here — or it will be merged away the first time it shares a call with a
 * colour.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "meta", "aux", "ui", "title", "prose", "lede", "display"] }],
    },
  },
})

export function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** Elapsed as a stopwatch, which is how a running note is actually read. */
export function duration(from: number, to: number | null): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

export function money(usd: number | null): string | null {
  if (usd === null) return null
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`
}

/**
 * A cost figure.
 *
 * There used to be a ≈ on anything priced from tokens rather than billed. It
 * marked the wrong boundary: both agents here run on subscriptions, so *no*
 * figure on that page is a charge anyone makes — the tilde implied the rest
 * were exact. Usage says once, in a sentence, that all of it is an estimate,
 * which is both truer and easier to read than a symbol on every number.
 *
 * `source` is kept in the data because provenance is still worth recording;
 * it is just not a per-number decoration.
 */
export function cost(usd: number | null, _source?: string): string | null {
  return money(usd)
}

export function compact(n: number | null): string | null {
  if (n === null) return null
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** A path shortened from the left — the end is the part that identifies it. */
export function tailPath(p: string, max = 38): string {
  if (p.length <= max) return p
  return "…" + p.slice(p.length - max + 1)
}
