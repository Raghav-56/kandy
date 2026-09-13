import { useMemo } from "react"
import type { ActivityFrame, BoardView, Note } from "@kandy/core"
import { Button, Empty, Kbd } from "@/ui"
import { Logo } from "@/brand/Logo"
import { GROUPS, LOOK } from "@/features/notes/status"
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

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-3">
      {groups.map((g) => (
        <section key={g.key} className="mb-5">
          <header className="sticky top-0 z-10 flex items-baseline gap-2 bg-bg/85 px-3 py-2 backdrop-blur">
            <h2 className="text-[12px] font-semibold tracking-[-0.005em] text-dim">{g.title}</h2>
            <span className="text-[11px] tabular-nums text-faint">{g.notes.length}</span>
          </header>

          <div className="space-y-0.5">
            {g.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                run={view.runs.find((r) => r.id === note.runId)}
                activity={note.runId ? activity[note.runId] : undefined}
                selected={selectedId === note.id}
                onSelect={() => onSelect(note.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="px-3">
        <button
          onClick={onCompose}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-[12.5px] text-faint transition-colors hover:border-[#3a3850] hover:text-dim"
        >
          <span className="text-[14px] leading-none">+</span>
          New note
          <Kbd className="ml-auto">C</Kbd>
        </button>
      </div>
    </div>
  )
}

/** Most urgent first; within a group, most recently touched first. */
function byUrgencyThenRecency(a: Note, b: Note): number {
  const d = LOOK[a.status].urgency - LOOK[b.status].urgency
  return d !== 0 ? d : b.updatedAt - a.updatedAt
}
