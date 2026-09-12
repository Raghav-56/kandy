import type { AgentInfo, Board } from "@kandy/core"
import { cn } from "@/lib/utils"

export function TopBar({
  boards,
  boardId,
  onBoardChange,
  onNewBoard,
  repoPath,
  agents,
  connected,
  running,
  blocked,
}: {
  boards: Board[]
  boardId: string | null
  onBoardChange: (id: string) => void
  onNewBoard: () => void
  repoPath: string | undefined
  agents: AgentInfo[]
  connected: boolean
  running: number
  blocked: number
}) {
  return (
    <header className="flex shrink-0 items-center gap-5 border-b border-line-soft px-5 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[14px] font-semibold tracking-[-0.02em]">kandy</span>
        {repoPath && (
          <span className="max-w-[38ch] truncate font-mono text-[11px] text-faint">
            {repoPath.replace(/^\/Users\/[^/]+/, "~")}
          </span>
        )}
      </div>

      <nav className="flex items-center gap-1">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => onBoardChange(b.id)}
            className={cn(
              "rounded-md px-2 py-1 text-[12.5px] transition-colors",
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
          className="ml-0.5 h-6 w-6 rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
        >
          +
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-4">
        {running > 0 && (
          <span className="flex items-center gap-1.5 text-[12px] text-dim">
            <span className="breathe h-1.5 w-1.5 rounded-full bg-amber" />
            {running} running
          </span>
        )}
        {blocked > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-[#2a1714] px-2.5 py-1 text-[11.5px] font-medium text-coral">
            <span className="h-1.5 w-1.5 rounded-full bg-coral" />
            {blocked} needs you
          </span>
        )}

        <div className="flex items-center gap-2.5 border-l border-line-soft pl-4">
          {agents
            .filter((a) => a.installed)
            .map((a) => (
              <span
                key={a.id}
                title={a.version ?? undefined}
                className={cn("text-[11.5px]", a.authed ? "text-dim" : "text-faint")}
              >
                {a.id}
              </span>
            ))}
        </div>

        <span
          title={connected ? "live" : "reconnecting"}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected ? "bg-sage" : "breathe bg-amber",
          )}
        />
      </div>
    </header>
  )
}
