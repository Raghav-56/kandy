import { useState } from "react"
import { notesIn, type BoardView, type Note } from "@kandy/core"
import { cn } from "@/lib/utils"
import { NoteCard } from "./NoteCard"

type Drop = { columnId: string; afterId: string | null }

export function Board({
  view,
  selectedId,
  onSelect,
  onMove,
  onCompose,
}: {
  view: BoardView
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
    <div className="flex h-full gap-3 overflow-x-auto px-5 pb-5 pt-4">
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
              "flex min-w-[250px] max-w-[340px] flex-1 shrink-0 flex-col rounded-xl border bg-panel transition-colors",
              over ? "border-[#2f2f3a] bg-[#101014]" : "border-line-soft",
            )}
          >
            <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
              <h2 className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink">
                {col.name}
              </h2>
              <span className="label mt-px">{notes.length}</span>
              <button
                onClick={() => onCompose(col.id)}
                title="New note"
                className="ml-auto -mr-1 h-6 w-6 rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
              >
                +
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
              <DropLine active={over && drop?.afterId === null} />

              {notes.map((note) => (
                <div key={note.id}>
                  <NoteCard
                    note={note}
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
                    className="h-3"
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
                  className="rounded-[10px] border border-dashed border-line py-3.5 text-[12px] text-faint transition-colors hover:border-[#33333d] hover:text-dim"
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
