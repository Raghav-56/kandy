import { useMemo } from "react"
import type { BoardView } from "@kandy/core"
import { Empty, Hint, Separator } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { Gauge } from "lucide-react"
import { compact, cost, duration, money } from "@/lib/utils"

/**
 * Where the money and the tokens went.
 *
 * Cost provenance is shown rather than smoothed over: Claude reports dollars,
 * Codex reports only tokens and is priced from a rate table. A total made of
 * both says how much of it is estimated instead of presenting one confident
 * number that is partly a guess.
 */
export function UsagePage({ view }: { view: BoardView | null }) {
  const rows = useMemo(() => {
    if (!view) return []
    const byNote = new Map<string, { title: string; runs: number; tokens: number; cost: number; estimated: boolean; agent: string | null }>()
    for (const run of view.runs) {
      const note = view.notes.find((n) => n.id === run.noteId)
      if (!note) continue
      const cur = byNote.get(note.id) ?? {
        title: note.title,
        runs: 0,
        tokens: 0,
        cost: 0,
        estimated: false,
        agent: note.agent,
      }
      cur.runs += 1
      cur.tokens += run.tokens ?? 0
      cur.cost += run.costUsd ?? 0
      cur.estimated ||= run.costSource === "estimated"
      byNote.set(note.id, cur)
    }
    return [...byNote.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  }, [view])

  if (!view || view.runs.length === 0) {
    return (
      <Empty
        className="pt-[16vh]"
        icon={<Gauge className="size-9" />}
        title="Nothing has run yet"
        body="Once an agent works on a note, what it cost and how many tokens it used shows up here — per note and per agent."
      />
    )
  }

  const totalCost = view.runs.reduce((t, r) => t + (r.costUsd ?? 0), 0)
  const totalTokens = view.runs.reduce((t, r) => t + (r.tokens ?? 0), 0)
  const totalTime = view.runs.reduce((t, r) => t + ((r.endedAt ?? Date.now()) - r.startedAt), 0)
  const anyEstimated = view.runs.some((r) => r.costSource === "estimated")
  const unpriced = view.runs.filter((r) => r.tokens !== null && r.costUsd === null).length

  const byAgent = new Map<string, { tokens: number; cost: number; runs: number; estimated: boolean }>()
  for (const r of view.runs) {
    const cur = byAgent.get(r.agent) ?? { tokens: 0, cost: 0, runs: 0, estimated: false }
    cur.tokens += r.tokens ?? 0
    cur.cost += r.costUsd ?? 0
    cur.runs += 1
    cur.estimated ||= r.costSource === "estimated"
    byAgent.set(r.agent, cur)
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-8">
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Usage</h1>
      <p className="text-muted-foreground mt-1 text-[12.5px]">{view.board.name}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Spend"
          value={`${anyEstimated ? "≈" : ""}${money(totalCost) ?? "$0.00"}`}
          note={anyEstimated ? "partly estimated" : "as reported"}
        />
        <Metric label="Tokens" value={compact(totalTokens) ?? "0"} />
        <Metric label="Runs" value={String(view.runs.length)} note={unpriced ? `${unpriced} unpriced` : undefined} />
        <Metric label="Agent time" value={duration(0, totalTime)} />
      </div>

      <section className="mt-8">
        <h2 className="text-[13px] font-semibold">By agent</h2>
        <div className="mt-3 space-y-1">
          {[...byAgent.entries()].map(([agent, v]) => (
            <div key={agent} className="flex items-center gap-3 rounded-lg px-3 py-2.5 odd:bg-muted/40">
              <AgentMark agent={agent as never} size={14} />
              <span className="flex-1 text-[13px]">{agentLabel(agent as never)}</span>
              <span className="text-muted-foreground w-20 text-right text-[12px] tabular-nums">
                {v.runs} runs
              </span>
              <span className="text-muted-foreground w-24 text-right text-[12px] tabular-nums">
                {compact(v.tokens)} tok
              </span>
              <span className="w-20 text-right text-[12.5px] tabular-nums">
                {v.cost > 0 ? cost(v.cost, v.estimated ? "estimated" : "reported") : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="text-[13px] font-semibold">By note</h2>
        <div className="mt-3 space-y-1">
          {rows.map((r) => (
            <div key={r.title} className="flex items-center gap-3 rounded-lg px-3 py-2.5 odd:bg-muted/40">
              {r.agent && <AgentMark agent={r.agent as never} size={13} />}
              <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
              <span className="text-muted-foreground w-24 text-right text-[12px] tabular-nums">
                {compact(r.tokens)} tok
              </span>
              <span className="w-20 text-right text-[12.5px] tabular-nums">
                {r.cost > 0 ? (
                  <Hint text={r.estimated ? "Estimated from tokens — this agent reports no cost." : "Reported by the agent."}>
                    <span>{cost(r.cost, r.estimated ? "estimated" : "reported")}</span>
                  </Hint>
                ) : (
                  "—"
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-card rounded-xl border px-4 py-3.5">
      <p className="label">{label}</p>
      <p className="mt-1.5 text-[19px] font-medium tracking-[-0.02em] tabular-nums">{value}</p>
      {note && <p className="text-muted-foreground/70 mt-0.5 text-[11px]">{note}</p>}
    </div>
  )
}
