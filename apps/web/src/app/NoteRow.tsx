import type { ActivityFrame, Note, Run } from "@kandy/core"
import { Badge, ActivityLine } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { PrBadge } from "@/features/notes/PrBadge"
import { LOOK } from "@/features/notes/status"
import { cn, compact, duration, money } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"

/**
 * One unit of work, as a row.
 *
 * A row rather than a card because the question the list answers is "what needs
 * me next", and that is a vertical scan. Everything on it is something you'd
 * act on: who is doing it, what it is, what it is doing right now, what it cost,
 * and whether there is a PR.
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
  useTick(live)

  return (
    <button
      onClick={onSelect}
      data-note={note.id}
      aria-current={selected}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-raised" : "hover:bg-surface",
      )}
    >
      {/* Selection is a spine, not a border — it doesn't move the content. */}
      <span
        className={cn(
          "absolute inset-y-2 left-0 w-[3px] rounded-full transition-opacity",
          selected ? "bg-sky opacity-100" : "opacity-0",
        )}
      />

      <span className="mt-0.5 shrink-0">
        {note.agent ? (
          <AgentMark agent={note.agent} size={15} />
        ) : (
          <span className="block h-[15px] w-[15px] rounded-full border border-dashed border-line" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
            {note.title}
          </span>
          {run && (
            <span className="shrink-0 text-[11px] tabular-nums text-faint">
              {duration(run.startedAt, run.endedAt)}
            </span>
          )}
        </span>

        {/* Live: what it's doing. Otherwise: what it produced. */}
        {live && activity ? (
          <span className="mt-1.5 block">
            <span className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-[11px] font-medium text-lemon">{activity.tool}</span>
              <span className="truncate font-mono text-[10.5px] text-faint">{activity.detail}</span>
            </span>
            <ActivityLine className="mt-1" />
          </span>
        ) : (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Badge tone={look.tone} dot pulse={note.status === "running"}>
              {look.label}
            </Badge>
            {note.agent && <span className="text-[11px] text-faint">{agentLabel(note.agent)}</span>}
            {note.stat && note.stat.files > 0 && (
              <span className="text-[11px] tabular-nums text-faint">
                <span className="text-mint">+{note.stat.insertions}</span>{" "}
                <span className="text-berry">−{note.stat.deletions}</span>{" "}
                {note.stat.files}f
              </span>
            )}
            {run?.tokens != null && (
              <span className="text-[11px] tabular-nums text-faint">{compact(run.tokens)} tok</span>
            )}
            {run?.costUsd != null && (
              <span className="text-[11px] tabular-nums text-faint">{money(run.costUsd)}</span>
            )}
            {note.pr && <PrBadge pr={note.pr} onDark />}
          </span>
        )}
      </span>
    </button>
  )
}
