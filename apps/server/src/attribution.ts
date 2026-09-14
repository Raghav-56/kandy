import type { AgentId, DiffStat, Attribution } from "@kandy/core"

/**
 * How kandy signs the history it produces.
 *
 * Everything here is pure: it turns "what ran" into lines of text. Whether
 * those lines are used at all is the board's decision (see Attribution), and
 * the callers in worktree.ts and http.ts must ask for them rather than being
 * handed them — when a board says no, no code here runs and the git command
 * is the one we would have issued before any of this existed.
 */

/**
 * Who to credit. The agent, never a person.
 *
 * A Co-Authored-By naming a human is a lie with consequences: it puts someone
 * in `git shortlog`, in GitHub's contributor list, and in the blame a future
 * reader trusts, for work they did not write and may never have read. The
 * agent is the co-author. If a person wants credit they can add themselves.
 */
const IDENTITY: Record<AgentId, { name: string; email: string }> = {
  claude: { name: "Claude", email: "noreply@anthropic.com" },
  codex: { name: "Codex", email: "noreply@openai.com" },
  aider: { name: "Aider", email: "noreply@aider.chat" },
  cursor: { name: "Cursor Agent", email: "noreply@cursor.com" },
  opencode: { name: "opencode", email: "noreply@opencode.ai" },
  gemini: { name: "Gemini", email: "noreply@google.com" },
  grok: { name: "Grok", email: "noreply@x.ai" },
}

/** What produced a commit. Everything optional except the note it came from. */
export type Provenance = {
  noteId: string
  runId?: string | null
  agent?: AgentId | null
  /** The model that actually ran, resolved from note override or board default. */
  model?: string | null
}

/**
 * The trailers for one commit, in the order git will print them.
 *
 * Keys are fixed and greppable on purpose — the whole point of using real
 * trailers rather than a prose footer is that
 *   git log --format='%(trailers:key=Kandy-Note,valueonly)'
 * answers "which note produced this commit" without parsing English. Renaming
 * a key breaks every query anyone has written against it, so these are API.
 *
 * A trailer with nothing to say is omitted rather than emitted empty: a
 * `Kandy-Agent:` with no value is noise in history forever.
 */
export function commitTrailers(p: Provenance): string[] {
  const lines = [`Kandy-Note: ${p.noteId}`]
  if (p.runId) lines.push(`Kandy-Run: ${p.runId}`)
  if (p.agent) {
    lines.push(`Kandy-Agent: ${p.model ? `${p.agent} (${p.model})` : p.agent}`)
    const who = IDENTITY[p.agent]
    if (who) lines.push(`Co-Authored-By: ${who.name} <${who.email}>`)
  }
  return lines
}

/**
 * Trailers folded into a message, for commands that take a message but have no
 * `--trailer` of their own — `git merge` being the one we need.
 *
 * `git commit --trailer` is preferred wherever it is available (git ≥ 2.32; we
 * target 2.39), because git does the formatting and gets the edge cases right.
 * This is the same shape by hand: subject, blank line, trailer block.
 */
export function withTrailers(message: string, trailers: readonly string[]): string {
  if (trailers.length === 0) return message
  return `${message}\n\n${trailers.join("\n")}`
}

/**
 * The PR body a reviewer actually needs.
 *
 * What they will ask, in order: what was this meant to do, and what wrote it.
 * The note's prompt answers the first — it is the brief the agent worked to,
 * so a reviewer reading it can tell "does the diff do this" from "does the
 * diff do something else that also passes".
 *
 * Deliberately absent: any link back to the board. It lives at
 * http://127.0.0.1:4477 on one laptop. A URL only the author can open is worse
 * than no URL — it looks like a reference and resolves to a connection error.
 */
export function prBody(
  note: { body: string; agent: AgentId | string | null; stat?: DiffStat | null },
  opts: { model?: string | null; footer: boolean; summary?: string | null },
): string {
  const brief = note.body.trim()

  /*
   * What the agent said it did.
   *
   * Its closing message is written for a person — the last turn always is —
   * and it is the difference between a reviewer knowing what to look for and
   * reading a diff cold. Without it, a PR opened from a note with no detail
   * said "_No description given._" and nothing else, while this sat unread in
   * a transcript.
   */
  const summary = opts.summary?.trim()

  const stat =
    note.stat && note.stat.files > 0
      ? `\`${note.stat.files}\` file${note.stat.files === 1 ? "" : "s"} changed, ` +
        `\`+${note.stat.insertions}\` \`-${note.stat.deletions}\``
      : null

  const sections: { heading: string; text: string }[] = []
  if (brief) sections.push({ heading: "The brief", text: brief })
  if (summary) sections.push({ heading: "What the agent did", text: summary })
  if (stat) sections.push({ heading: "The diff", text: stat })

  /*
   * Headings only once there is more than one thing to head.
   *
   * A note with a written brief and no run is just that brief; putting "### The
   * brief" above a single paragraph is furniture. Structure appears when
   * structure is doing something.
   */
  const lines =
    sections.length === 0
      ? ["_No description given._"]
      : sections.length === 1
        ? [sections[0]!.text]
        : sections.flatMap((sec, i) => (i === 0 ? [] : [""]).concat([`### ${sec.heading}`, "", sec.text]))

  if (!opts.footer) return lines.join("\n")

  lines.push("", "---", "")
  lines.push(
    note.agent
      ? `Written by \`${note.agent}\`${opts.model ? ` (\`${opts.model}\`)` : ""}, from a kandy note.`
      : "Opened from a kandy note.",
  )
  lines.push("")
  lines.push("🍬 Queued and run with [kandy](https://github.com/hiteshbandhu/kandy)")
  return lines.join("\n")
}

/** Normalize whatever a client sent into a complete, both-keys-present value. */
export function coerceAttribution(input: unknown): Attribution {
  const o = (input ?? {}) as Partial<Record<keyof Attribution, unknown>>
  return { commit: o.commit === true, pr: o.pr === true }
}
