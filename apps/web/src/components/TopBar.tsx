import type { AgentInfo, Board, BoardView } from "@kandy/core"
import { cn, money, tailPath } from "@/lib/utils"
import { AgentMark, agentLabel } from "./AgentMark"

export function TopBar({
  boards,
  boardId,
  view,
  onBoardChange,
  onNewBoard,
  agents,
  connected,
}: {
  boards: Board[]
  boardId: string | null
  view: BoardView | null
  onBoardChange: (id: string) => void
  onNewBoard: () => void
  agents: AgentInfo[]
  connected: boolean
}) {
  const notes = view?.notes ?? []
  const running = notes.filter((n) => n.status === "running").length
  const blocked = notes.filter((n) => n.status === "blocked").length
  const review = notes.filter((n) => n.status === "review").length
  // What this board has cost, ever. A number nobody tracks is a number that
  // surprises you at the end of the month.
  const spend = (view?.runs ?? []).reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  return (
    <header className="flex shrink-0 items-center gap-5 border-b border-line-soft px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[14.5px] font-semibold tracking-[-0.025em]">kandy</span>
        {view && (
          <span className="hidden font-mono text-[11px] text-faint lg:block">
            {tailPath(view.board.repoPath.replace(/^\/Users\/[^/]+/, "~"))}
          </span>
        )}
      </div>

      <nav className="flex items-center gap-1">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => onBoardChange(b.id)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors",
              b.id === boardId
                ? "bg-panel-2 text-ink"
                : "text-dim hover:bg-panel-2/60 hover:text-ink",
            )}
          >
            {b.name}
          </button>
        ))}
        <button
          onClick={onNewBoard}
          title="New board"
          aria-label="New board"
          className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-[15px] leading-none text-faint transition-colors hover:bg-panel-2 hover:text-ink"
        >
          +
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {blocked > 0 && <Pill tone="coral" label="needs you" value={blocked} pulse />}
        {running > 0 && <Pill tone="amber" label={running === 1 ? "running" : "running"} value={running} pulse />}
        {review > 0 && <Pill tone="sage" label="to review" value={review} />}
        {spend > 0 && (
          <span className="rounded-full border border-line px-2.5 py-1 text-[11.5px] tabular-nums text-dim">
            {money(spend)}
          </span>
        )}

        <div className="ml-2 flex items-center gap-2.5 border-l border-line-soft pl-4">
          {agents
            .filter((a) => a.installed)
            .map((a) => (
              <span
                key={a.id}
                title={`${agentLabel(a.id)}${a.version ? ` — ${a.version}` : ""}${a.authed ? "" : " (not signed in)"}`}
                className={cn("flex items-center", a.authed ? "opacity-100" : "opacity-40")}
              >
                <AgentMark agent={a.id} size={15} />
              </span>
            ))}
        </div>

        <span
          title={connected ? "live" : "reconnecting"}
          className={cn(
            "ml-1 h-1.5 w-1.5 rounded-full",
            connected ? "bg-sage" : "breathe bg-amber",
          )}
        />
      </div>
    </header>
  )
}

function Pill({
  tone,
  label,
  value,
  pulse,
}: {
  tone: "coral" | "amber" | "sage"
  label: string
  value: number
  pulse?: boolean
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
        tone === "coral" && "bg-[#2a1714] text-coral",
        tone === "amber" && "bg-[#1f1810] text-amber",
        tone === "sage" && "bg-[#131d14] text-sage",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "coral" && "bg-coral",
          tone === "amber" && "bg-amber",
          tone === "sage" && "bg-sage",
          pulse && "breathe",
        )}
      />
      <span className="tabular-nums">{value}</span> {label}
    </span>
  )
}
