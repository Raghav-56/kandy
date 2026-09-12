import type { ActivityFrame, Note, Run } from "@kandy/core"
import { cn, duration, money } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"
import { AgentMark, agentLabel } from "./AgentMark"
import { DiffBar } from "./DiffBar"
import { STYLES, inkFor } from "./status"

export function NoteCard({
  note,
  run,
  activity,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  note: Note
  run: Run | undefined
  activity: ActivityFrame | undefined
  selected: boolean
  dragging: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const s = STYLES[note.status]
  const live = note.status === "running" || note.status === "queued"
  const onDark = note.status === "done" || note.status === "failed"
  useTick(live)

  const elapsed = run ? duration(run.startedAt, run.endedAt) : null
  const cost = money(run?.costUsd ?? null)

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
        "paper group relative flex cursor-pointer overflow-hidden rounded-xl transition-all duration-150",
        s.surface,
        "rotate-[-0.25deg] even:rotate-[0.2deg] hover:-translate-y-0.5 hover:rotate-0",
        selected && "rotate-0 ring-2 ring-azure ring-offset-2 ring-offset-bg",
        dragging && "opacity-25",
        note.status === "done" && "opacity-60 hover:opacity-100",
      )}
    >
      {/* The spine: the fastest read on the card. */}
      <span className={cn("w-[3px] shrink-0", s.edge)} />

      <div className="min-w-0 flex-1 px-3.5 py-3">
        {/* The colour lives on the row so the agent mark, which inherits
            currentColor, is legible on paper as well as on the dark surfaces. */}
        <header className={cn("flex items-center gap-2", s.muted)}>
          {note.agent ? (
            <>
              <AgentMark agent={note.agent} size={13} />
              <span className="text-[11.5px] font-medium">{agentLabel(note.agent)}</span>
            </>
          ) : (
            <span className="text-[11.5px]">Unassigned</span>
          )}

          <span className="ml-auto flex items-center gap-1.5">
            {elapsed && <span className="text-[11px] tabular-nums">{elapsed}</span>}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                s.dot,
                note.status === "running" && "breathe",
              )}
            />
          </span>
        </header>

        <p
          className={cn(
            "mt-2.5 text-[14px] font-medium leading-[1.4] tracking-[-0.005em]",
            inkFor(note.status),
          )}
        >
          {note.title}
        </p>

        {/* What it's doing, right now. Live-only, so absent is fine. */}
        {note.status === "running" && activity && (
          <div
            className={cn(
              "mt-2.5 flex items-center gap-1.5 rounded-md px-2 py-1.5",
              onDark ? "bg-panel" : "bg-black/[0.045]",
            )}
          >
            <span className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-amber" />
            <span className={cn("shrink-0 text-[11px] font-medium", s.muted)}>{activity.tool}</span>
            <span className={cn("truncate font-mono text-[10.5px]", s.muted, "opacity-80")}>
              {activity.detail}
            </span>
          </div>
        )}

        {(note.stat || cost || note.status === "blocked") && (
          <>
            <div className={cn("my-2.5 h-px", s.rule)} />
            <footer
              className={cn("flex items-center gap-3 text-[11px]", s.muted)}
            >
              {note.stat && <DiffBar stat={note.stat} onDark={onDark} />}
              {note.stat && note.stat.files > 0 && (
                <span className="tabular-nums">
                  {note.stat.files} {note.stat.files === 1 ? "file" : "files"}
                </span>
              )}
              {note.status === "blocked" && (
                <span className="font-medium text-coral">Waiting on you</span>
              )}
              {cost && <span className="ml-auto tabular-nums">{cost}</span>}
            </footer>
          </>
        )}
      </div>
    </article>
  )
}
