import { useState } from "react"
import { notesIn, type ActivityFrame, type BoardView, type Note } from "@kandy/core"
import { cn } from "@/lib/utils"
import { NoteCard } from "./NoteCard"

type Drop = { columnId: string; afterId: string | null }

export function Board({
  view,
  activity,
  selectedId,
  onSelect,
  onMove,
  onCompose,
}: {
  view: BoardView
  activity: Record<string, ActivityFrame>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (noteId: string, columnId: string, afterId: string | null) => void
  onCompose: (columnId: string) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)

  function commit() {
    if (dragId && drop) onMove(dragId, drop.columnId, drop.afterId)
    setDragId(null)
    setDrop(null)
  }

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 pb-6 pt-5">
      {view.columns.map((col) => {
        const notes = notesIn(view, col.id)
        const over = drop?.columnId === col.id

        return (
          <section
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault()
              // Dropping on the column body, below every card, means "last".
              if (!drop || drop.columnId !== col.id) {
                setDrop({ columnId: col.id, afterId: notes.at(-1)?.id ?? null })
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              commit()
            }}
            className={cn(
              // Flex so the default five lanes fill the window instead of
              // overflowing it; a wider board still scrolls.
              // Five default lanes have to fit a laptop without the last one
              // hanging off the edge; a sixth starts scrolling.
              "flex min-w-[240px] max-w-[400px] flex-1 flex-col rounded-2xl border transition-colors",
              over ? "border-[#2f2f3a] bg-[#101014]" : "border-line-soft bg-panel",
            )}
          >
            <header className="flex items-center gap-2.5 px-4 pb-3 pt-4">
              <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{col.name}</h2>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  notes.length ? "bg-panel-2 text-dim" : "text-faint",
                )}
              >
                {notes.length}
              </span>
              <button
                onClick={() => onCompose(col.id)}
                title="New note"
                aria-label={`New note in ${col.name}`}
                className="ml-auto -mr-1 flex h-7 w-7 items-center justify-center rounded-lg text-[15px] leading-none text-faint transition-colors hover:bg-panel-2 hover:text-ink"
              >
                +
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
              <DropLine active={over && drop?.afterId === null} />

              {notes.map((note) => (
                <div key={note.id}>
                  <NoteCard
                    note={note}
                    run={view.runs.find((r) => r.id === note.runId)}
                    activity={note.runId ? activity[note.runId] : undefined}
                    selected={selectedId === note.id}
                    dragging={dragId === note.id}
                    onSelect={() => onSelect(note.id)}
                    onDragStart={() => setDragId(note.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setDrop(null)
                    }}
                  />
                  {/* A generous strip under each card so aiming between two
                      notes doesn't require precision. */}
                  <div
                    className="h-3.5"
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDrop({ columnId: col.id, afterId: note.id })
                    }}
                  >
                    <DropLine active={over && drop?.afterId === note.id} />
                  </div>
                </div>
              ))}

              {notes.length === 0 && (
                <button
                  onClick={() => onCompose(col.id)}
                  className="rounded-xl border border-dashed border-line py-4 text-[12px] text-faint transition-colors hover:border-[#33333d] hover:bg-panel-2/40 hover:text-dim"
                >
                  New note
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Where the card will land. Without it, dropping is a guess. */
function DropLine({ active }: { active: boolean | undefined }) {
  return (
    <div
      className={cn(
        "h-[2px] rounded-full transition-all",
        active ? "bg-azure opacity-100" : "opacity-0",
      )}
    />
  )
}
