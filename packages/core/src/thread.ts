import type { AgentId, DiffStat, Note, Run } from "./domain.js"
import type { TranscriptFrame } from "./events.js"

/**
 * A note's work, in a form another agent can pick up.
 *
 * The problem this solves: a note is welded to the agent that started it.
 * Claude Code resumes by session id and Codex by thread id, both local to the
 * machine and meaningless to the other tool, so "continue this with a
 * different agent" has no native answer anywhere.
 *
 * What makes it cheap for us is that every adapter already normalises to the
 * same frames — text, tool, usage, blocked, error — and the store keeps them
 * with no trace of which CLI produced them. So this is a projection over data
 * we already have, in the same spirit as every other projection in kandy,
 * rather than a new pipeline.
 *
 * Three tiers of fidelity, and only one is lossless. Git carries the code
 * perfectly. This carries the conversation well but lossily. The agent's own
 * session carries nothing at all, because it cannot. Hence the honest framing
 * the docs settled on: hand off the thread, not resume the session.
 *
 * See docs/16-threads.md.
 */

/**
 * One moment worth inheriting.
 *
 * Deliberately not "a message". A 48-turn transcript is mostly the agent
 * reading files, and the next agent will read them again anyway because its
 * context is empty. What survives is what a person would say if asked "where
 * did you get to" — the asks, the conclusions, and the things that failed.
 */
export type Beat = {
  at: number
  who: "human" | "agent"
  /** Which agent said it. Absent for the human, who is only ever one person. */
  agent?: AgentId
  kind: "ask" | "decision" | "failure" | "blocked"
  text: string
}

export type Thread = {
  /** The original ask, verbatim. The next agent should see what was wanted. */
  note: { id: string; title: string; body: string }
  /** Where the code is. A receiving runner needs nothing else to find it. */
  code: { branch: string | null; stat: DiffStat | null }
  /** Who has worked on this, on what, and how far they got. */
  runs: {
    agent: AgentId
    model: string | null
    status: Run["status"]
    turns: number | null
  }[]
  /** The distilled conversation, oldest first. */
  arc: Beat[]
  /** The last thing the agent said, when a run ended without resolving it. */
  open: string | null
}

/** Frames belonging to one run, so a beat can be attributed to its agent. */
export type RunFrames = { run: Run; frames: TranscriptFrame[] }

/**
 * Distil, mechanically.
 *
 * Mechanical on purpose. A model-written summary is the obvious upgrade and
 * the wrong place to start: it is unverifiable, it costs a call, and it hides
 * whether the extraction underneath was any good. Rules first; if the rules
 * are not enough, that will be visible rather than hidden behind prose.
 *
 * What survives:
 *
 * - every human message, verbatim — the ask and every steer
 * - each run's closing assistant message, which is where an agent says what it
 *   concluded. We already extract exactly this for PR bodies, where it turned
 *   `_No description given._` into 1,914 useful characters
 * - every error, and every refusal — a sandbox denial is a fact about the
 *   task, and rediscovering it costs a turn
 *
 * What does not: `read`, `grep`, and every other successful tool call. That is
 * the bulk of a transcript and none of it is knowledge; it is one agent's
 * route to knowledge, which the next agent cannot walk anyway.
 */
export function buildThread(note: Note, history: readonly RunFrames[]): Thread {
  const arc: Beat[] = []
  let open: string | null = null
  let lastEverSaid: { at: number; agent: AgentId; text: string } | null = null

  for (const { run, frames } of history) {
    const agent = run.agent

    for (const f of frames) {
      if (f.role === "user") {
        // The human's own words. Includes the note body on the first run, which
        // would duplicate `note` above — dropped, since the briefing prints the
        // note itself first and reading the task twice is worse than once.
        const text = f.text.trim()
        if (text && text !== note.body.trim() && text !== note.title.trim()) {
          arc.push({ at: f.ts, who: "human", kind: "ask", text })
        }
      } else if (f.role === "error") {
        arc.push({ at: f.ts, who: "agent", agent, kind: "failure", text: f.text.trim() })
      }
    }

    /*
     * The closing message, and only from a run that reached its own end.
     *
     * Taken per run rather than per turn because an agent restates itself
     * constantly and only the last one is a conclusion. Gated on `done`
     * because the last thing an *interrupted* run said is a sentence about
     * what it was about to do — "I'll explore the repo structure first" —
     * which reads as a finding and is worse than silence. Real transcripts are
     * full of these; the unit tests were not.
     */
    const said = frames.filter((f) => f.role === "assistant" && f.text.trim())
    const last = said.at(-1)
    if (last) {
      lastEverSaid = { at: last.ts, agent, text: last.text.trim() }
      if (run.status === "succeeded") {
        arc.push({ at: last.ts, who: "agent", agent, kind: "decision", text: last.text.trim() })
        open = last.text.trim()
      }
    }
  }

  /*
   * If nothing finished, the half-thought is all there is.
   *
   * A note whose every run was interrupted still has to hand over something,
   * and where it got to mid-sentence beats an empty briefing.
   */
  if (open === null && lastEverSaid) {
    arc.push({ ...lastEverSaid, who: "agent", kind: "decision" })
    open = lastEverSaid.text
  }

  arc.sort((a, b) => a.at - b.at)

  return {
    note: { id: note.id, title: note.title, body: note.body },
    code: { branch: note.branch, stat: note.stat },
    runs: history.map(({ run }) => ({
      agent: run.agent,
      model: run.model,
      status: run.status,
      turns: run.turns,
    })),
    arc,
    // A note that finished cleanly has nothing open; the last thing said was a
    // report, not a loose end.
    open: note.status === "done" ? null : open,
  }
}

/** How an agent is named to another agent. */
const NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "opencode",
  aider: "Aider",
  gemini: "Gemini",
  grok: "Grok",
}

/**
 * The briefing an agent actually receives.
 *
 * Order is the whole design, and it is the order that stops the next agent
 * re-deriving what is already known: what was wanted, where the code stands,
 * what has been settled, what has already failed, and the one thing left.
 *
 * The diff is named but never described. Git carries it perfectly and the
 * agent can read it; prose about code is a worse copy of something already
 * present, and it goes stale the moment anything changes.
 *
 * `to` is the agent about to read this. It is told plainly that someone else
 * did the earlier work, because an agent that believes it wrote code it has
 * never read will act on a memory it does not have.
 */
export function renderBriefing(thread: Thread, to: AgentId): string {
  const prior = [...new Set(thread.runs.map((r) => r.agent))].filter((a) => a !== to)
  const out: string[] = []

  out.push(`# ${thread.note.title}`)
  if (thread.note.body.trim()) out.push(thread.note.body.trim())

  if (prior.length > 0) {
    const who = prior.map((a) => NAMES[a] ?? a).join(" and ")
    const turns = thread.runs.reduce((n, r) => n + (r.turns ?? 0), 0)
    out.push(
      `## Before you\n\nThis work was started by ${who}${turns > 0 ? `, over ${turns} turns` : ""}. ` +
        `You are picking it up. You did not write any of the code below — read it before changing it.`,
    )
  }

  if (thread.code.branch) {
    const s = thread.code.stat
    const changed = s
      ? `${s.files} file${s.files === 1 ? "" : "s"} changed, +${s.insertions} −${s.deletions}`
      : "no changes committed yet"
    out.push(
      `## The code\n\nYou are on branch \`${thread.code.branch}\` — ${changed}. ` +
        `The working tree is as they left it; \`git diff\` and \`git log\` are the truth about it.`,
    )
  }

  const decisions = thread.arc.filter((b) => b.kind === "decision")
  const asks = thread.arc.filter((b) => b.kind === "ask")
  const failures = thread.arc.filter((b) => b.kind === "failure" || b.kind === "blocked")

  if (asks.length > 0) {
    out.push(`## What was asked along the way\n\n${asks.map((b) => `- ${oneLine(b.text)}`).join("\n")}`)
  }

  // Everything but the last: the last one is the open thread and is printed
  // under its own heading, where it reads as an instruction rather than history.
  const settled = thread.open ? decisions.slice(0, -1) : decisions
  if (settled.length > 0) {
    out.push(
      `## What they established\n\n` +
        settled.map((b) => `**${NAMES[b.agent ?? ""] ?? b.agent}:** ${demote(b.text)}`).join("\n\n"),
    )
  }

  if (failures.length > 0) {
    out.push(
      `## What already failed\n\n` +
        failures.map((b) => `- ${oneLine(b.text)}`).join("\n") +
        `\n\nThese are facts about the task, not bad luck. Do not spend a turn rediscovering them.`,
    )
  }

  if (thread.open) {
    out.push(`## Where it stopped\n\n${demote(thread.open)}\n\nContinue from there.`)
  }

  return out.join("\n\n")
}

/**
 * Push an embedded message's headings below our own.
 *
 * An agent's closing message is often a small document with `## What I did` in
 * it, and pasted verbatim under our `## What they established` it stops being
 * nested and starts being a sibling — the briefing's structure dissolves into
 * the quoted text.
 */
function demote(md: string): string {
  return md.replace(/^(#{1,6}) /gm, (_m, h: string) => "#".repeat(Math.min(h.length + 2, 6)) + " ")
}

/** A beat on one line, since a list of paragraphs is not a list. */
function oneLine(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…"
}
