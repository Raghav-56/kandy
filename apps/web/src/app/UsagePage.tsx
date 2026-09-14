import { useEffect, useMemo, useState } from "react"
import { useCountUp } from "@/hooks/useCountUp"
import type { BoardView, Stats } from "@kandy/core"
import type { KandyClient } from "@kandy/client"
import { Empty, Hint, Kbd, Separator } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { Activity, Funnel, Hours, RankedBars, SplitBar } from "@/features/usage/Charts"
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
export function UsagePage({
  view,
  client,
}: {
  view: BoardView | null
  client: KandyClient
}) {
  /*
   * The daemon already computes all of this — funnel, activity, hours, tools —
   * for `kandy stats`, and the web app had never asked for it. Fetched rather
   * than derived here so the CLI and the board cannot drift into two different
   * answers about the same board.
   */
  const [stats, setStats] = useState<Stats | null>(null)
  const boardId = view?.board.id ?? null
  useEffect(() => {
    setStats(null)
    if (!boardId) return
    let stale = false
    void client
      .stats(boardId)
      .then((r) => !stale && setStats(r))
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [boardId, client])

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
  const held = view.notes.filter((n) => n.status === "done" && n.worktree).length
  const totalTime = view.runs.reduce((t, r) => t + ((r.endedAt ?? Date.now()) - r.startedAt), 0)
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
        <CountMetric
          label="Spend"
          to={totalCost}
          format={(n) => money(n) ?? "$0.00"}
          note="estimated"
        />
        <CountMetric label="Tokens" to={totalTokens} format={(n) => compact(n) ?? "0"} />
        <Metric label="Runs" value={String(view.runs.length)} note={unpriced ? `${unpriced} unpriced` : undefined} />
        <Metric label="Agent time" value={duration(0, totalTime)} />
      </div>

      {/*
        Said once, rather than a symbol on every number.

        Both agents run on plans — Claude Code on a subscription, Codex on a
        ChatGPT account — so none of these figures is a charge anybody makes.
        Claude reports dollars for a turn and Codex reports only tokens, which
        kandy prices from a rate table, and neither is a bill.
      */}
      <p className="text-muted-foreground/70 mt-3 text-[11.5px] leading-relaxed">
        Every figure here is an estimate. These agents run on subscriptions, so nothing below is
        billed per token — it is what the same work would cost at API rates, which is useful for
        comparing notes against each other and not for predicting an invoice.
      </p>

      {/* Disk is the cost this page was missing. Every finished note keeps a
          whole checkout until it is reclaimed, and nothing anywhere said so. */}
      {held > 0 && (
        <p className="text-muted-foreground/70 mt-3 text-[11.5px] leading-relaxed">
          {held} finished {held === 1 ? "note is" : "notes are"} still holding a worktree — a whole
          checkout each. <Kbd>kandy gc</Kbd> gives the disk back and leaves every branch where it is.
        </p>
      )}

      <section className="mt-9">
        <h2 className="text-[13px] font-semibold">Split between agents</h2>
        <p className="text-muted-foreground mt-1 text-[12px]">
          Of {money(totalCost) ?? "$0.00"} estimated, and who ran it up.
        </p>
        <SplitBar
          className="mt-4"
          total={totalCost > 0 ? totalCost : totalTokens}
          parts={[...byAgent.entries()].map(([agent, v], i) => ({
            key: agent,
            label: agentLabel(agent as never),
            value: totalCost > 0 ? v.cost : v.tokens,
            display:
              totalCost > 0
                ? (cost(v.cost, v.estimated ? "estimated" : "reported") ?? "—")
                : `${compact(v.tokens)} tok`,
            // Fixed order, never cycled: an agent keeps its colour whether or
            // not the other one has run today.
            mark: i === 0 ? "var(--color-mark-1)" : "var(--color-mark-2)",
          }))}
        />

        <ul className="mt-5 space-y-0.5">
          {[...byAgent.entries()].map(([agent, v]) => (
            <li
              key={agent}
              className="odd:bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2"
            >
              <AgentMark agent={agent as never} size={14} />
              <span className="flex-1 text-[12.5px]">{agentLabel(agent as never)}</span>
              <span className="text-muted-foreground w-20 text-right text-[12px] tabular-nums">
                {v.runs} runs
              </span>
              <span className="text-muted-foreground w-24 text-right text-[12px] tabular-nums">
                {compact(v.tokens)} tok
              </span>
              <span className="w-20 text-right text-[12.5px] tabular-nums">
                {v.cost > 0 ? cost(v.cost, v.estimated ? "estimated" : "reported") : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {stats && (
        <>
          <Separator className="my-9" />

          <div className="grid gap-9 sm:grid-cols-2">
            <section>
              <h2 className="text-[13px] font-semibold">Where work goes</h2>
              <p className="text-muted-foreground mt-1 text-[12px]">
                And where it stops. {stats.firstTry.landed} of {stats.firstTry.of} landed on the
                first run.
              </p>
              <Funnel
                className="mt-4"
                stages={[
                  { key: "written", label: "Written", value: stats.funnel.written },
                  { key: "ran", label: "Ran", value: stats.funnel.ran },
                  { key: "reviewed", label: "Reviewed", value: stats.funnel.reviewed },
                  { key: "landed", label: "Landed", value: stats.funnel.landed },
                ]}
              />
            </section>

            <section>
              <h2 className="text-[13px] font-semibold">When you run them</h2>
              <p className="text-muted-foreground mt-1 text-[12px]">
                Runs started in each hour, across the whole board.
              </p>
              <Hours className="mt-4" hours={stats.hours} />
            </section>
          </div>

          <Separator className="my-9" />

          <section>
            <h2 className="text-[13px] font-semibold">Twelve weeks</h2>
            <p className="text-muted-foreground mt-1 text-[12px]">
              Runs per day, empty days included — a gap says the board sat still.
            </p>
            <Activity className="mt-4" daily={stats.daily} />
          </section>

          {stats.tools.length > 0 && (
            <>
              <Separator className="my-9" />
              <section>
                <h2 className="text-[13px] font-semibold">What the agents reached for</h2>
                <p className="text-muted-foreground mt-1 text-[12px]">
                  Tool calls across every run.
                </p>
                <RankedBars
                  className="mt-4"
                  max={stats.tools[0]?.calls ?? 0}
                  rows={stats.tools.slice(0, 8).map((t) => ({
                    key: t.tool,
                    label: t.tool,
                    value: t.calls,
                    display: String(t.calls),
                  }))}
                />
              </section>
            </>
          )}
        </>
      )}

      <Separator className="my-9" />

      <section>
        <h2 className="text-[13px] font-semibold">Where it went</h2>
        <p className="text-muted-foreground mt-1 text-[12px]">
          Every note that has run, dearest first. Bar length is cost against the
          most expensive one.
        </p>
        {/* The bars and the numbers are the same rows — this is the table,
            readable as a shape. */}
        <RankedBars
          className="mt-4"
          max={rows[0]?.cost ?? 0}
          rows={rows.map((r, i) => ({
            key: `${r.title}-${i}`,
            label: r.title,
            value: r.cost,
            display: r.cost > 0 ? (cost(r.cost, r.estimated ? "estimated" : "reported") ?? "—") : "—",
            meta: `${compact(r.tokens)} tok`,
          }))}
        />
      </section>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-card rounded-xl border px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1.5 text-[19px] font-medium tracking-[-0.02em] tabular-nums">{value}</p>
      {note && <p className="text-muted-foreground/70 mt-0.5 text-[11px]">{note}</p>}
    </div>
  )
}

/**
 * A metric that counts to its figure.
 *
 * Only spend and tokens get this. Run count and elapsed time are facts you
 * read once; these two are the ones you watch change while an agent works.
 */
function CountMetric({
  label,
  to,
  format,
  note,
}: {
  label: string
  to: number
  format: (n: number) => string
  note?: string
}) {
  return <Metric label={label} value={format(useCountUp(to))} note={note} />
}
