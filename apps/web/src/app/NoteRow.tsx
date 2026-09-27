import { memo } from "react"
import { Trash2 } from "lucide-react"
import type { ActivityFrame, Note, Run } from "@kandy/core"
import { ActivityLine, Button, CopyLink, Hint, StatusPill } from "@/ui"
import { AgentMark } from "@/features/agents/AgentMark"
import { PrBadge } from "@/features/notes/PrBadge"
import { HeldCallout, RunnerChip } from "@/features/team/team"
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
 *
 * Memoised, because the list re-renders on every streamed event and every
 * one-second tick. Without this, one running note repaints eighty rows a
 * minute and the whole list visibly flickers.
 */
export const NoteRow = memo(function NoteRow({
  note,
  run,
  activity,
  selected,
  statusImplied,
  onSelect,
  onRequestDelete,
}: {
  note: Note
  run: Run | undefined
  activity: ActivityFrame | undefined
  selected: boolean
  /** The group heading already names this status; don't repeat it on the row. */
  statusImplied?: boolean
  onSelect: (id: string) => void
  /** Opens the board's confirm dialog; the row never deletes on its own. */
  onRequestDelete: (note: Note) => void
}) {
  const look = LOOK[note.status]
  const live = note.status === "running" || note.status === "queued"
  const settled = note.status === "done"
  useTick(live)

  return (
    /* The delete control is a sibling of the row rather than a child: the row
       is itself a <button>, and a button nested in a button is invalid markup
       that browsers resolve by dropping the inner one. Overlaying it also
       means a click on delete never reaches the row's own onClick. */
    <div className="group/row" data-flip={note.id}>
    {/* Its own positioning box, so the delete control centres on the row and
        not on the row plus a held callout beneath it. */}
    <div className="relative">
    <button
      onClick={() => onSelect(note.id)}
      data-note={note.id}
      aria-current={selected}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left",
        /* Press gives, so a row feels like an object rather than a link. 0.96
           is the value that reads as tactile without looking exaggerated.
           `scale`, not `transform`: Tailwind v4 compiles scale-* to the
           standalone property, which a transform transition never sees. */
        "transition-[background-color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
        selected ? "bg-accent" : "hover:bg-accent/50",
        settled && !selected && "opacity-65 hover:opacity-100",
      )}
    >
      <span className="mt-[3px] shrink-0">
        {note.agent ? (
          <AgentMark agent={note.agent} size={15} />
        ) : (
          <span className="border-muted-foreground/40 block size-[15px] rounded-full border border-dashed" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-title font-medium">{note.title}</span>
          {run && (
            <span
              className={cn(
                "shrink-0 text-meta tabular-nums transition-opacity",
                /* Steps aside on hover rather than being covered up — the
                   delete button sits in this corner. */
                "group-hover/row:opacity-0",
                live ? "text-lemon" : "text-muted-foreground/60",
              )}
            >
              {duration(run.startedAt, run.endedAt)}
            </span>
          )}
        </span>

        {live && run?.quietSince ? (
          /* The agent has gone silent: say so where the activity would be. */
          <span className="mt-1.5 block text-meta text-lemon">
            No output for {quietFor(run.quietSince)} — may be stuck
          </span>
        ) : live && activity ? (
          /* What it is doing, not what it will have done. */
          <span className="mt-1.5 block">
            <span className="flex items-baseline gap-1.5">
              <span className="text-lemon shrink-0 text-meta font-medium">{activity.tool}</span>
              <span className="text-muted-foreground/70 truncate font-mono text-micro">
                {activity.detail}
              </span>
            </span>
            <ActivityLine className="mt-1" />
          </span>
        ) : (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {!statusImplied && (
              <StatusPill tone={look.tone} pulse={note.status === "running"}>
                {look.label}
              </StatusPill>
            )}

            {note.stat && note.stat.files > 0 && (
              <Hint text={`${note.stat.files} file${note.stat.files > 1 ? "s" : ""} changed`}>
                <span className="text-meta tabular-nums">
                  <span className="text-mint">+{note.stat.insertions}</span>{" "}
                  <span className="text-berry">−{note.stat.deletions}</span>
                </span>
              </Hint>
            )}

            {note.pr && <PrBadge pr={note.pr} onDark />}

            <RunnerChip note={note} />

            {/* Which model actually did the work — the harnesses tell us, and
                it is the first thing you want when a result looks off. */}
            {run?.model && (
              <span className="text-muted-foreground/50 truncate font-mono text-micro">
                {run.model}
              </span>
            )}

            {/* Only worth saying once it is worth saying. */}
            {run?.costUsd != null && run.costUsd >= 0.01 && (
              <span className="text-muted-foreground/60 text-meta tabular-nums">
                {cost(run.costUsd, run.costSource)}
              </span>
            )}
          </span>
        )}
      </span>
    </button>

      <span
        className={cn(
          "absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition",
          /* Hidden until wanted, but never unreachable: keyboard focus inside
             brings the whole group back. */
          "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
        )}
      >
        <CopyLink
          path={`/b/${note.boardId}/n/${note.id}`}
          label="Copy link to this note"
          size="icon-xs"
        />

        <Hint text="Delete note">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRequestDelete(note)}
            aria-label={`Delete note: ${note.title}`}
            className="hover:bg-berry/12 hover:text-berry"
          >
            <Trash2 className="size-3" />
          </Button>
        </Hint>
      </span>
    </div>

    {/* Outside the row's <button>, because it has buttons of its own. Indented
        to the title so it reads as part of this note, not the next. */}
    <HeldCallout note={note} compact className="mb-1.5 ml-[39px] mr-3" />
    </div>
  )
})

/** "3 min" — how long a run has said nothing. */
export function quietFor(since: number): string {
  const m = Math.max(1, Math.round((Date.now() - since) / 60_000))
  return `${m} min`
}
