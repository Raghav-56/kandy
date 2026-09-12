import type { Note } from "@kandy/core"
import { cn } from "@/lib/utils"
import { STYLES } from "./status"

export function NoteCard({
  note,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  note: Note
  selected: boolean
  dragging: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const s = STYLES[note.status]
  const live = note.status === "running"

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", note.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        "paper group relative cursor-pointer overflow-hidden rounded-[10px] px-3 py-2.5 transition-all duration-150",
        s.surface,
        // A hair of rotation so a column reads as paper rather than a table.
        "rotate-[-0.35deg] even:rotate-[0.3deg]",
        "hover:-translate-y-0.5 hover:rotate-0",
        selected && "rotate-0 ring-2 ring-azure ring-offset-2 ring-offset-bg",
        dragging && "opacity-30",
        note.status === "done" && "opacity-55 hover:opacity-90",
      )}
    >
      {/* Running work sweeps a warm line across its top edge. */}
      {live && <div className="sweep absolute inset-x-0 top-0 h-[2px] overflow-hidden" />}

      <p className={cn("text-[13px] font-medium leading-[1.35]", s.ink)}>{note.title}</p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", s.dot, live && "breathe")} />
        <span className={cn("label", s.muted)}>{s.label}</span>
        {note.agent && (
          <span className={cn("label ml-auto", s.muted)}>{note.agent}</span>
        )}
      </div>
    </article>
  )
}
