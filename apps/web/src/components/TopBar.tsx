import type { AgentInfo, Board } from "@kandy/core"
import { cn } from "@/lib/utils"

/**
 * Brand left, state right — DESIGN.md's nav is heavy type and nothing else.
 * No icons; the only chrome is a hairline that says whether we're live.
 */
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
    <header className="flex shrink-0 items-center gap-10 border-b border-[#1c1c1c] px-6 py-3">
      <div>
        <div className="display display-sm">kandy</div>
        <div className="meta mt-0.5 max-w-[46ch] truncate font-mono">{repoPath ?? "no board"}</div>
      </div>

      <nav className="flex items-center gap-6">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => onBoardChange(b.id)}
            className={cn(
              "display display-xs transition-colors",
              b.id === boardId ? "text-paper-white" : "text-ash hover:text-[#d4d4d4]",
            )}
          >
            {b.name}
          </button>
        ))}
        <button onClick={onNewBoard} className="display display-xs text-ash hover:text-paper-white">
          + Board
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-6">
        {/* Counts, not badges. The number is the signal. */}
        {running > 0 && (
          <span className="display display-xs text-paper-white">{running} running</span>
        )}
        {blocked > 0 && (
          <span className="display display-xs bg-paper-white px-2 py-1 text-obsidian">
            {blocked} blocked
          </span>
        )}

        <div className="flex items-center gap-3">
          {agents
            .filter((a) => a.installed)
            .map((a) => (
              <span
                key={a.id}
                title={a.version ?? undefined}
                className={cn("display display-xs", a.authed ? "text-[#d4d4d4]" : "text-smoke")}
              >
                {a.id}
              </span>
            ))}
        </div>

        <span
          title={connected ? "live" : "reconnecting"}
          className={cn("h-3 w-3", connected ? "bg-paper-white" : "border border-ash")}
        />
      </div>
    </header>
  )
}
