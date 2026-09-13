import type { BoardView, Run, Stats } from "@kandy/core"
import type { Store } from "./store.js"

/**
 * What a board has actually done.
 *
 * Every figure here is derived from events that already exist — no new
 * tracking, no estimates dressed as measurements. Where a number is partly
 * computed rather than reported (Codex bills no dollars) that is carried
 * alongside it rather than smoothed away, because a total that quietly mixes
 * the two overstates its own precision.
 */

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

const duration = (r: Run) => (r.endedAt ?? Date.now()) - r.startedAt

export function computeStats(view: BoardView, store: Store): Stats {
  const { notes, runs } = view
  const finished = runs.filter((r) => r.endedAt !== null)

  const landed = notes.filter((n) => n.outcome === "merged")
  const discarded = notes.filter((n) => n.outcome === "discarded")
  const failed = notes.filter((n) => n.status === "failed")
  const open = notes.filter((n) => n.status !== "done" && n.status !== "failed")

  const usd = runs.reduce((t, r) => t + (r.costUsd ?? 0), 0)
  const tokens = runs.reduce((t, r) => t + (r.tokens ?? 0), 0)
  const estimated = runs.some((r) => r.costSource === "estimated")

  const code = notes.reduce(
    (acc, n) => ({
      insertions: acc.insertions + (n.stat?.insertions ?? 0),
      deletions: acc.deletions + (n.stat?.deletions ?? 0),
      files: acc.files + (n.stat?.files ?? 0),
    }),
    { insertions: 0, deletions: 0, files: 0 },
  )
  const lines = code.insertions + code.deletions

  // One run and no follow-up means the note was understood first time.
  const runsPerNote = new Map<string, number>()
  for (const r of runs) runsPerNote.set(r.noteId, (runsPerNote.get(r.noteId) ?? 0) + 1)
  const firstTryLanded = landed.filter((n) => (runsPerNote.get(n.id) ?? 0) <= 1).length

  const byHour = new Map<number, number>()
  for (const r of runs) {
    const h = new Date(r.startedAt).getHours()
    byHour.set(h, (byHour.get(h) ?? 0) + 1)
  }
  const busiest = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]

  const title = (id: string) => notes.find((n) => n.id === id)?.title ?? "a note"

  const longestRun = finished.sort((a, b) => duration(b) - duration(a))[0]
  const dearest = [...runs].filter((r) => r.costUsd !== null).sort((a, b) => b.costUsd! - a.costUsd!)[0]

  const agentIds = [...new Set(runs.map((r) => r.agent))]
  const agents = agentIds
    .map((agent) => {
      const mine = runs.filter((r) => r.agent === agent)
      const noteIds = new Set(mine.map((r) => r.noteId))
      return {
        agent,
        runs: mine.length,
        landed: landed.filter((n) => noteIds.has(n.id)).length,
        discarded: discarded.filter((n) => noteIds.has(n.id)).length,
        usd: mine.reduce((t, r) => t + (r.costUsd ?? 0), 0),
        estimated: mine.some((r) => r.costSource === "estimated"),
        medianMs: median(mine.filter((r) => r.endedAt !== null).map(duration)),
      }
    })
    .sort((a, b) => b.landed - a.landed || b.runs - a.runs)

  // 12 weeks of days, including the empty ones — a gap is information.
  const DAYS = 84
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const perDay = new Map<string, number>()
  for (const r of runs) perDay.set(day(r.startedAt), (perDay.get(day(r.startedAt)) ?? 0) + 1)

  const daily: { date: string; runs: number }[] = []
  const today = new Date()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    daily.push({ date: key, runs: perDay.get(key) ?? 0 })
  }

  const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? 0)

  // Only notes that still exist: a deleted note leaves its runs behind, and
  // counting those made "ran" exceed "written".
  const live = new Set(notes.map((n) => n.id))
  const ranNotes = new Set(runs.map((r) => r.noteId).filter((id) => live.has(id)))
  const reviewed = notes.filter((n) => n.outcome !== null || n.status === "review").length

  return {
    board: { name: view.board.name, repoPath: view.board.repoPath },
    notes: {
      total: notes.length,
      landed: landed.length,
      discarded: discarded.length,
      open: open.length,
      failed: failed.length,
    },
    runs: {
      total: runs.length,
      medianMs: median(finished.map(duration)),
      ...(longestRun
        ? { longest: { ms: duration(longestRun), title: title(longestRun.noteId) } }
        : { longest: null }),
    },
    spend: {
      usd,
      estimated,
      tokens,
      unpricedRuns: runs.filter((r) => r.tokens !== null && r.costUsd === null).length,
    },
    code,
    firstTry: { landed: firstTryLanded, of: landed.length },
    linesPerDollar: usd > 0 && lines > 0 ? Math.round(lines / usd) : null,
    tokensPerLine: lines > 0 && tokens > 0 ? Math.round(tokens / lines) : null,
    busiestHour: busiest ? { hour: busiest[0], runs: busiest[1] } : null,
    priciest: dearest
      ? {
          usd: dearest.costUsd!,
          title: title(dearest.noteId),
          estimated: dearest.costSource === "estimated",
        }
      : null,
    agents,
    // The one figure that needs the transcript table, aggregated in SQL rather
    // than by reading every frame into memory.
    tools: store.toolCounts(runs.map((r) => r.id)),
    daily,
    hours,
    funnel: {
      written: notes.length,
      ran: ranNotes.size,
      reviewed,
      landed: landed.length,
      // Work that was started and did not land: discarded, failed, abandoned.
      lost: discarded.length + failed.length,
    },
  }
}
