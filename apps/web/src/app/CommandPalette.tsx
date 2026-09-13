import { useEffect, useMemo, useState } from "react"
import type { AgentId, AgentInfo, Board, BoardView } from "@kandy/core"
import { Kbd } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { LOOK } from "@/features/notes/status"
import { cn } from "@/lib/utils"

export type Command = {
  id: string
  label: string
  hint?: string
  group: string
  icon?: React.ReactNode
  run: () => void
}

/**
 * One place to reach everything.
 *
 * The alternative to a palette is a chrome budget: every action needs a button,
 * every button needs a home, and the interface fills up. This keeps the surface
 * quiet and makes the app navigable without a mouse.
 */
export function CommandPalette({
  open,
  onClose,
  view,
  boards,
  agents,
  onSelectNote,
  onCompose,
  onNewBoard,
  onBoardChange,
  onRunNote,
}: {
  open: boolean
  onClose: () => void
  view: BoardView | null
  boards: Board[]
  agents: AgentInfo[]
  onSelectNote: (id: string) => void
  onCompose: () => void
  onNewBoard: () => void
  onBoardChange: (id: string) => void
  onRunNote: (noteId: string, agent: AgentId) => void
}) {
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [
      { id: "new-note", label: "New note", hint: "C", group: "Actions", run: onCompose },
      { id: "new-board", label: "Add a repo", group: "Actions", run: onNewBoard },
    ]

    for (const b of boards) {
      out.push({
        id: `board-${b.id}`,
        label: b.name,
        hint: "board",
        group: "Repos",
        run: () => onBoardChange(b.id),
      })
    }

    for (const n of view?.notes ?? []) {
      const look = LOOK[n.status]
      out.push({
        id: `note-${n.id}`,
        label: n.title,
        hint: look.label,
        group: "Notes",
        icon: n.agent ? <AgentMark agent={n.agent} size={13} /> : undefined,
        run: () => onSelectNote(n.id),
      })
    }

    // Running a draft is the single most common two-step, so it gets one step.
    for (const n of view?.notes ?? []) {
      if (n.status !== "draft") continue
      for (const a of agents.filter((x) => x.installed)) {
        out.push({
          id: `run-${n.id}-${a.id}`,
          label: `Run "${n.title}"`,
          hint: `with ${agentLabel(a.id)}`,
          group: "Run",
          icon: <AgentMark agent={a.id} size={13} />,
          run: () => onRunNote(n.id, a.id),
        })
      }
    }
    return out
  }, [view, boards, agents, onCompose, onNewBoard, onBoardChange, onSelectNote, onRunNote])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands.slice(0, 40)
    return commands
      .filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [commands, q])

  useEffect(() => setCursor(0), [q, open])
  useEffect(() => {
    if (open) setQ("")
  }, [open])

  if (!open) return null

  const choose = (c: Command | undefined) => {
    if (!c) return
    c.run()
    onClose()
  }

  let lastGroup = ""

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-6 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise w-[min(620px,100%)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/60">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes, repos, actions…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3.5 text-[14px] text-ink placeholder:text-faint focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose()
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === "Enter") {
              e.preventDefault()
              choose(results[cursor])
            }
          }}
        />

        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-faint">Nothing matches.</p>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <p className="label px-4 pb-1 pt-2.5">{header}</p>}
                <button
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(c)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-left",
                    i === cursor ? "bg-raised" : "",
                  )}
                >
                  {c.icon ?? <span className="w-[13px]" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-[11px] text-faint">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <footer className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </footer>
      </div>
    </div>
  )
}
