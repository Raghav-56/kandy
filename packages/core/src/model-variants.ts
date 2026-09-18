/**
 * Pulling the knobs back out of a model id.
 *
 * Cursor's catalogue is 224 ids, and almost all of that is one model crossed
 * with its settings: `claude-opus-5`, `claude-opus-5-low`,
 * `claude-opus-5-thinking-xhigh-fast` and seventeen more are the same model.
 * Decomposed, 224 ids are **50 models** with three knobs — how hard it thinks,
 * whether it thinks out loud, and whether it runs on the fast tier.
 *
 * Which is how everyone else models it. t3code gives a model
 * `optionDescriptors` — `{ id: "reasoningEffort", label: "Reasoning", type:
 * "select", options: [...] }` — and renders one control per descriptor, so
 * effort is a thing you set rather than a thing spelled into the name. Cursor
 * spells it into the name; this reads it back out so the picker can offer the
 * same shape.
 *
 * Deliberately lossless. `format(parse(id))` is the original id for every one
 * of the 224, because the id is what `--model` is given and a picker that
 * cannot reproduce it exactly is a picker that silently runs the wrong model.
 */

/** How hard it thinks, weakest first. Absent means the model's own default. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

export type Effort = (typeof EFFORTS)[number]

export type Variant = {
  /** The model proper, with every knob stripped: `claude-opus-5`. */
  family: string
  effort: Effort | null
  /** Cursor's own reasoning toggle, which is separate from effort. */
  thinking: boolean
  /** The fast tier, which is a price and latency choice rather than a model. */
  fast: boolean
}

/**
 * Suffix order is fixed and load-bearing: family, thinking, effort, fast.
 *
 * Taken from the catalogue rather than assumed — `claude-opus-5-thinking-xhigh-fast`
 * exists and `claude-opus-5-xhigh-thinking-fast` does not.
 */
export function parseVariant(id: string): Variant {
  let rest = id
  let fast = false
  let effort: Effort | null = null
  let thinking = false

  if (rest.endsWith("-fast")) {
    rest = rest.slice(0, -"-fast".length)
    fast = true
  }
  for (const e of EFFORTS) {
    if (rest.endsWith(`-${e}`)) {
      rest = rest.slice(0, -(e.length + 1))
      effort = e
      break
    }
  }
  if (rest.endsWith("-thinking")) {
    rest = rest.slice(0, -"-thinking".length)
    thinking = true
  }

  return { family: rest, effort, thinking, fast }
}

export function formatVariant(v: Variant): string {
  return (
    v.family + (v.thinking ? "-thinking" : "") + (v.effort ? `-${v.effort}` : "") + (v.fast ? "-fast" : "")
  )
}

/**
 * What a model can be set to, in the shape a picker wants.
 *
 * One entry per family, carrying only the knobs that family actually has —
 * `gpt-5.3-codex` offers low, high and xhigh and no medium, and saying
 * otherwise offers a model that does not exist.
 */
export type Family = {
  family: string
  /** Every id this family covers, so the caller can check a choice is real. */
  ids: string[]
  /** Efforts on offer. Empty when the family has no effort variants at all. */
  efforts: Effort[]
  /** Whether `-thinking` and `-fast` versions exist. */
  thinking: boolean
  fast: boolean
  /** The plainest id — no knobs set — when there is one. */
  base: string | null
}

export function describeFamilies(ids: readonly string[]): Family[] {
  const byFamily = new Map<string, Family>()

  for (const id of ids) {
    const v = parseVariant(id)
    let f = byFamily.get(v.family)
    if (!f) {
      f = { family: v.family, ids: [], efforts: [], thinking: false, fast: false, base: null }
      byFamily.set(v.family, f)
    }
    f.ids.push(id)
    if (v.effort && !f.efforts.includes(v.effort)) f.efforts.push(v.effort)
    f.thinking ||= v.thinking
    f.fast ||= v.fast
    if (!v.effort && !v.thinking && !v.fast) f.base = id
  }

  for (const f of byFamily.values()) {
    f.efforts.sort((a, b) => EFFORTS.indexOf(a) - EFFORTS.indexOf(b))
  }
  // Catalogue order, which is the provider's own recommendation — `auto` first.
  return [...byFamily.values()]
}

/**
 * The closest id a family actually has to the knobs asked for.
 *
 * Turning a knob must never produce an id the account cannot run: switching
 * family while "xhigh" is selected has to fall back when the new family stops
 * at high, rather than composing `gpt-5.4-max` because the last one had it.
 */
export function resolveVariant(f: Family, want: Partial<Variant>): string {
  const effort = want.effort && f.efforts.includes(want.effort) ? want.effort : null
  const candidate = formatVariant({
    family: f.family,
    effort,
    thinking: (want.thinking ?? false) && f.thinking,
    fast: (want.fast ?? false) && f.fast,
  })
  if (f.ids.includes(candidate)) return candidate

  // Nothing composed cleanly — the plain id if it exists, else anything real.
  return f.base ?? f.ids[0] ?? f.family
}
