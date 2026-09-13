import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import type { ActivityFrame, BoardView, Note } from "@kandy/core"
import { Button, Empty, Kbd } from "@/ui"
import { Logo } from "@/brand/Logo"
import { GROUPS, LOOK } from "@/features/notes/status"
import { cn } from "@/lib/utils"
import { NoteRow } from "./NoteRow"

/**
 * The list, grouped by what you should deal with first.
 *
 * Sorted by urgency rather than by column, because status here is machine
 * state — a note arrives in "running" because a process started, not because
 * someone dragged it. A kanban board asks you to read five columns to find the
 * one thing that is waiting on you; this puts it at the top.
 */
export function TriageList({
  view,
  activity,
  selectedId,
  onSelect,
  onCompose,
}: {
  view: BoardView
  activity: Record<string, ActivityFrame>
  selectedId: string | null
  onSelect: (id: string) => void
  onCompose: () => void
}) {
  // Done is collapsed to start: eight finished notes should not take as much
  // room as the one thing waiting on you.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["done"]))

  const groups = useMemo(() => {
    return GROUPS.map((g) => ({
      ...g,
      notes: view.notes
        .filter((n) => g.statuses.includes(n.status))
        .sort(byUrgencyThenRecency),
    })).filter((g) => g.notes.length > 0)
  }, [view.notes])

  if (view.notes.length === 0) {
    return (
      <Empty
        className="pt-24"
        icon={<Logo size={40} />}
        title="Nothing on the board"
        body="A note is one job for one agent. Write what you want done — it runs in its own worktree, on its own branch, and comes back as a diff."
        action={
          <Button variant="default" size="default" onClick={onCompose}>
            Write the first note
          </Button>
        }
      />
    )
  }

  const open = view.notes.filter((n) => n.status !== "done").length

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-4">
      {/* The primary action, shaped like the thing it makes. A dashed button at
          the bottom of a list is where you put something you hope nobody
          needs. */}
      <button
        onClick={onCompose}
        className="bg-card hover:border-grape/40 group mb-5 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors"
      >
        <Logo size={17} className="opacity-80" />
        <span className="text-muted-foreground group-hover:text-foreground flex-1 text-[13.5px] transition-colors">
          What should the agent do?
        </span>
        <Kbd>C</Kbd>
      </button>

      {open > 0 && (
        <p className="text-muted-foreground/60 mb-3 px-3 text-[11.5px]">
          {open} open · {view.notes.length - open} done
        </p>
      )}

      {groups.map((g) => {
        const open = !collapsed.has(g.key)
        return (
        <section key={g.key} className="mb-5">
          <button
            onClick={() =>
              setCollapsed((c) => {
                const next = new Set(c)
                next.has(g.key) ? next.delete(g.key) : next.add(g.key)
                return next
              })
            }
            className="bg-background/85 text-muted-foreground hover:text-foreground sticky top-0 z-10 flex w-full items-center gap-1.5 px-3 py-2 text-left backdrop-blur transition-colors"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", open && "rotate-90")}
            />
            <h2 className="text-[12px] font-semibold tracking-[-0.005em]">{g.title}</h2>
            <span className="text-muted-foreground/60 text-[11px] tabular-nums">
              {g.notes.length}
            </span>
          </button>

          <div className={cn("space-y-0.5", !open && "hidden")}>
            {g.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                run={view.runs.find((r) => r.id === note.runId)}
                activity={note.runId ? activity[note.runId] : undefined}
                selected={selectedId === note.id}
                statusImplied={g.statuses.length === 1}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
        )
      })}

    </div>
  )
}

/** Most urgent first; within a group, most recently touched first. */
function byUrgencyThenRecency(a: Note, b: Note): number {
  const d = LOOK[a.status].urgency - LOOK[b.status].urgency
  return d !== 0 ? d : b.updatedAt - a.updatedAt
}
