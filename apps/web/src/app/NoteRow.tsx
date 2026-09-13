import type { ActivityFrame, Note, Run } from "@kandy/core"
import { ActivityLine, Hint, StatusPill } from "@/ui"
import { AgentMark } from "@/features/agents/AgentMark"
import { PrBadge } from "@/features/notes/PrBadge"
import { LOOK } from "@/features/notes/status"
import { cn, cost, duration } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"

/**
 * One unit of work, as a row.
 *
 * What earns a place here is what you would act on. The agent's *mark* stays
 * and its *name* went — the icon already said it, and a name repeated on every
 * row is a column of noise. Token counts went to Usage, which is where you go
 * when the question is "what did this cost" rather than "what needs me".
 *
 * A running row shows what the agent is doing right now instead of its
 * eventual result; a finished one shows the result instead of its history.
 */
export function NoteRow({
  note,
  run,
  activity,
  selected,
  onSelect,
}: {
  note: Note
  run: Run | undefined
  activity: ActivityFrame | undefined
  selected: boolean
  onSelect: () => void
}) {
  const look = LOOK[note.status]
  const live = note.status === "running" || note.status === "queued"
  const settled = note.status === "done"
  useTick(live)

  return (
    <button
      onClick={onSelect}
      data-note={note.id}
      aria-current={selected}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50",
        settled && !selected && "opacity-65 hover:opacity-100",
      )}
    >
      {/* Selection is a spine, not a border — it doesn't shift the content. */}
      <span
        className={cn(
          "bg-grape absolute inset-y-2 left-0 w-[3px] rounded-full transition-opacity",
          selected ? "opacity-100" : "opacity-0",
        )}
      />

      <span className="mt-[3px] shrink-0">
        {note.agent ? (
          <AgentMark agent={note.agent} size={15} />
        ) : (
          <span className="border-muted-foreground/40 block size-[15px] rounded-full border border-dashed" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{note.title}</span>
          {run && (
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                live ? "text-lemon" : "text-muted-foreground/60",
              )}
            >
              {duration(run.startedAt, run.endedAt)}
            </span>
          )}
        </span>

        {live && activity ? (
          /* What it is doing, not what it will have done. */
          <span className="mt-1.5 block">
            <span className="flex items-baseline gap-1.5">
              <span className="text-lemon shrink-0 text-[11px] font-medium">{activity.tool}</span>
              <span className="text-muted-foreground/70 truncate font-mono text-[10.5px]">
                {activity.detail}
              </span>
            </span>
            <ActivityLine className="mt-1" />
          </span>
        ) : (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusPill tone={look.tone} pulse={note.status === "running"}>
              {look.label}
            </StatusPill>

            {note.stat && note.stat.files > 0 && (
              <Hint text={`${note.stat.files} file${note.stat.files > 1 ? "s" : ""} changed`}>
                <span className="text-[11px] tabular-nums">
                  <span className="text-mint">+{note.stat.insertions}</span>{" "}
                  <span className="text-berry">−{note.stat.deletions}</span>
                </span>
              </Hint>
            )}

            {note.pr && <PrBadge pr={note.pr} onDark />}

            {/* Only worth saying once it is worth saying. */}
            {run?.costUsd != null && run.costUsd >= 0.01 && (
              <span className="text-muted-foreground/60 text-[11px] tabular-nums">
                {cost(run.costUsd, run.costSource)}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
