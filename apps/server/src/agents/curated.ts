/**
 * Models for agents that will not tell us their own.
 *
 * The tier below asking. Cursor and Codex both answer a question — `cursor-agent
 * models`, and `model/list` on Codex's app-server — so neither appears here.
 * Claude Code exposes nothing: there is no `claude models`, and asking for one
 * starts a session and treats the word as a prompt.
 *
 * Derived from T3 Code's `CLAUDE_MODEL_CATALOG` (MIT, Copyright (c) 2026
 * T3 Tools Inc.), which maintains the same list the same way — by hand, in a
 * pull request, because there is nothing to fetch.
 *
 * Kept deliberately short. The price table knows about far more Anthropic
 * models than Claude Code accepts, which is why it was the wrong source for
 * this menu: it was guessing from what is *sold* rather than stating what the
 * CLI *takes*. A model missing here is not a dead end — anything you add
 * yourself is offered alongside these.
 *
 * Aliases lead because they keep pointing at the current model when a new one
 * ships, so the top of this menu ages better than the rest of it.
 */

export type Curated = {
  id: string
  /** Oldest CLI that accepts it, when a newer one was needed. */
  since?: string
}

/*
 * Order is load-bearing: `defaultModelFor` takes the first entry, so this list
 * decides what a new note runs on. It is the order the table-derived menu had,
 * kept deliberately — reordering it here would silently change everyone's
 * default, which a menu change has no business doing.
 */
const CLAUDE: Curated[] = [
  { id: "fable" },
  { id: "opus" },
  { id: "sonnet" },
  { id: "haiku" },
  { id: "claude-opus-5", since: "2.0.0" },
  { id: "claude-fable-5", since: "2.0.0" },
  { id: "claude-sonnet-5" },
  { id: "claude-opus-4-8" },
  { id: "claude-opus-4-7" },
  { id: "claude-sonnet-4-6" },
  { id: "claude-haiku-4-5" },
]

const CURATED: Record<string, Curated[]> = { claude: CLAUDE }

/** `2.1.271 (Claude Code)` → `[2, 1, 271]`. Anything unparsable is unknown. */
function semver(v: string | null): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v ?? "")
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function atLeast(have: number[], want: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0
    const b = want[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/**
 * The curated list, minus anything this CLI is too old to accept.
 *
 * An unreadable version offers everything rather than nothing: a menu that
 * silently shrinks because a `--version` string changed shape is worse than
 * one that occasionally offers a model the agent then refuses by name.
 */
export function curatedModels(agent: string, version: string | null): string[] {
  const list = CURATED[agent]
  if (!list) return []
  const have = semver(version)
  return list
    .filter((m) => {
      if (!m.since || !have) return true
      const want = semver(m.since)
      return !want || atLeast(have, want)
    })
    .map((m) => m.id)
}
