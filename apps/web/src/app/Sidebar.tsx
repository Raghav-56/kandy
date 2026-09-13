import type { AgentInfo, Board, BoardView } from "@kandy/core"
import { Badge, Button, Hint, Kbd } from "@/ui"
import { Wordmark } from "@/brand/Logo"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { cn, compact, money, tailPath } from "@/lib/utils"

/**
 * Standing context: which repo, what is happening across it, what it has cost,
 * and which agents are actually available. Everything here is a fact about the
 * whole board, so none of it belongs in the list.
 */
export function Sidebar({
  boards,
  boardId,
  view,
  agents,
  connected,
  onBoardChange,
  onNewBoard,
}: {
  boards: Board[]
  boardId: string | null
  view: BoardView | null
  agents: AgentInfo[]
  connected: boolean
  onBoardChange: (id: string) => void
  onNewBoard: () => void
}) {
  const notes = view?.notes ?? []
  const count = (f: (s: string) => boolean) => notes.filter((n) => f(n.status)).length
  const attention = count((s) => s === "blocked" || s === "failed")
  const review = count((s) => s === "review")
  const running = count((s) => s === "running")

  const runs = view?.runs ?? []
  const spend = runs.reduce((t, r) => t + (r.costUsd ?? 0), 0)
  const tokens = runs.reduce((t, r) => t + (r.tokens ?? 0), 0)
  const unpriced = runs.filter((r) => r.tokens !== null && r.costUsd === null).length

  return (
    <aside className="flex w-[228px] shrink-0 flex-col gap-5 border-r border-hairline px-3 py-3.5">
      <div className="flex items-center justify-between px-2">
        <Wordmark />
        <Hint text={connected ? "Live" : "Reconnecting…"}>
          <span
            className={cn(
              "block h-1.5 w-1.5 rounded-full",
              connected ? "bg-mint" : "breathe bg-lemon",
            )}
          />
        </Hint>
      </div>

      <nav className="space-y-0.5">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => onBoardChange(b.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors",
              b.id === boardId ? "bg-raised text-ink" : "text-dim hover:bg-surface hover:text-ink",
            )}
          >
            <span className="truncate">{b.name}</span>
          </button>
        ))}
        <button
          onClick={onNewBoard}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-faint transition-colors hover:bg-surface hover:text-dim"
        >
          <span className="text-[14px] leading-none">+</span> Add a repo
        </button>
      </nav>

      {view && (
        <div className="space-y-2 px-2">
          <p className="truncate font-mono text-[11px] text-faint" title={view.board.repoPath}>
            {tailPath(view.board.repoPath.replace(/^\/Users\/[^/]+/, "~"), 26)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {attention > 0 && <Badge tone="berry" dot pulse>{attention} needs you</Badge>}
            {running > 0 && <Badge tone="lemon" dot pulse>{running} running</Badge>}
            {review > 0 && <Badge tone="mint" dot>{review} to review</Badge>}
          </div>
        </div>
      )}

      <div className="mt-auto space-y-3 px-2">
        {(spend > 0 || tokens > 0) && (
          <div>
            <p className="label">Spend</p>
            <p className="mt-1 text-[15px] font-medium tabular-nums text-ink">
              {money(spend) ?? "$0.00"}
            </p>
            {/* The caveat lives beside the number, not on it: say which slice is
                uncertain rather than disclaiming the whole figure. */}
            <p className="mt-0.5 text-[11px] text-faint">
              {compact(tokens)} tokens
              {unpriced > 0 && ` · ${unpriced} run${unpriced > 1 ? "s" : ""} unpriced`}
            </p>
          </div>
        )}

        <div>
          <p className="label">Agents</p>
          <div className="mt-1.5 space-y-1">
            {agents.filter((a) => a.installed).map((a) => (
              <Hint
                key={a.id}
                text={`${agentLabel(a.id)}${a.version ? ` — ${a.version}` : ""}${a.authed ? "" : " (not signed in)"}`}
              >
                <span className="flex items-center gap-2">
                  <AgentMark agent={a.id} size={13} />
                  <span className={cn("text-[11.5px]", a.authed ? "text-dim" : "text-faint")}>
                    {agentLabel(a.id)}
                  </span>
                  {!a.authed && <span className="text-[10px] text-faint">signed out</span>}
                </span>
              </Hint>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-t border-hairline pt-3">
          <Kbd>⌘K</Kbd>
          <span className="text-[11px] text-faint">for anything</span>
        </div>
      </div>
    </aside>
  )
}
