import { useEffect, useState } from "react"
import type {
  ActivityFrame,
  AgentId,
  AgentInfo,
  BoardView,
  Forge,
  Note,
  Policy,
  TranscriptFrame,
} from "@kandy/core"
import { Maximize2, Minimize2, X } from "lucide-react"
import { ActivityLine, Button, Hint, LoadingBlock, StatusPill, Textarea } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { DiffView } from "@/features/diff/DiffView"
import { InlineEdit } from "@/features/notes/InlineEdit"
import { PrBadge } from "@/features/notes/PrBadge"
import { LOOK } from "@/features/notes/status"
import { Transcript } from "@/features/stream/Transcript"
import { cn, compact, cost, duration } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"

export type NoteDetailProps = {
  note: Note
  view: BoardView
  agents: AgentInfo[]
  frames: TranscriptFrame[]
  activity: ActivityFrame | undefined
  forge: Forge | null
  onClose: () => void
  onRun: (agent?: AgentId) => void
  onCancel: (runId: string) => void
  onAssign: (agent: AgentId) => void
  onPolicy: (policy: Policy) => void
  onEdit: (patch: { title?: string; body?: string }) => Promise<boolean>
  onSteer: (text: string) => Promise<"live" | "queued" | undefined>
  onReview: (decision: "merge" | "discard") => void
  onOpenPr: () => Promise<void>
  onDelete: () => void
  loadDiff: () => Promise<{ diff: string; capturedAt: number | null } | undefined>
}

/**
 * Everything about one note.
 *
 * A pane beside the list by default, because reading a stream while scanning
 * what else is waiting is the normal motion. Full screen puts the stream and
 * the diff side by side, which is the review motion — what the agent said it
 * did, next to what it actually did.
 */
export function NoteDetail(p: NoteDetailProps) {
  const [tab, setTab] = useState<"stream" | "diff">("stream")
  const [diff, setDiff] = useState<{ text: string; capturedAt: number | null } | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<string | null>(null)
  const [pring, setPring] = useState(false)
  const [full, setFull] = useState(false)

  const run = p.view.runs.find((r) => r.id === p.note.runId)
  const live = p.note.status === "running" || p.note.status === "blocked"
  const reviewable = p.note.status === "review"
  const look = LOOK[p.note.status]
  const split = full && Boolean(p.note.branch)
  useTick(live)

  useEffect(() => {
    setDiff(null)
    if (tab === "diff" || split)
      void p.loadDiff().then((d) => d && setDiff({ text: d.diff, capturedAt: d.capturedAt }))
  }, [tab, split, p.note.id])

  useEffect(() => {
    if (reviewable) setTab("diff")
  }, [reviewable])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const how = await p.onSteer(text)
    setSending(false)
    if (how) {
      setDraft("")
      setDelivery(how === "live" ? "sent to the running agent" : "queued as a follow-up")
      setTimeout(() => setDelivery(null), 4000)
    }
  }

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-5 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={look.tone} pulse={p.note.status === "running"}>
                {look.label}
              </StatusPill>
              {p.note.agent && (
                <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
                  <AgentMark agent={p.note.agent} size={12} />
                  {agentLabel(p.note.agent)}
                </span>
              )}
            </div>

            <h2 className="mt-2.5 text-[16px] font-medium leading-snug tracking-[-0.015em]">
              <InlineEdit
                key={p.note.id}
                value={p.note.title}
                label="Edit title"
                required
                rows={2}
                onSave={(title) => p.onEdit({ title })}
              />
            </h2>
          </div>

          <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
            <Hint text={full ? "Narrow" : "Widen — stream beside diff"}>
              <Button variant="ghost" size="icon" onClick={() => setFull((f) => !f)}>
                {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </Hint>
            <Button variant="ghost" size="icon" onClick={p.onClose} aria-label="Close">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {run && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-dim">
            <span className={cn("tabular-nums", live && "text-lemon")}>
              {duration(run.startedAt, run.endedAt)}
            </span>
            {run.turns !== null && <><Sep /><span className="tabular-nums">{run.turns} turns</span></>}
            {run.tokens !== null && <><Sep /><span className="tabular-nums">{compact(run.tokens)} tok</span></>}
            {run.costUsd !== null ? (
              <>
                <Sep />
                <Hint
                  text={
                    run.costSource === "estimated"
                      ? `Estimated from ${run.tokens?.toLocaleString() ?? "?"} tokens${run.model ? ` at ${run.model} rates` : ""} — this agent reports no cost.`
                      : "Reported by the agent."
                  }
                >
                  <span className="tabular-nums">{cost(run.costUsd, run.costSource)}</span>
                </Hint>
              </>
            ) : run.tokens !== null ? (
              <>
                <Sep />
                <Hint text={`No price for ${run.model ?? "this model"}, so the cost is unknown.`}>
                  <span className="text-faint">unpriced</span>
                </Hint>
              </>
            ) : null}
          </div>
        )}

        {p.note.branch && (
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="min-w-0 truncate font-mono text-[11px] text-faint" title={p.note.branch}>
              {p.note.branch}
            </span>
            {p.note.pr && <PrBadge pr={p.note.pr} onDark />}
            {p.note.stat && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums">
                <span className="text-mint">+{p.note.stat.insertions}</span>{" "}
                <span className="text-berry">−{p.note.stat.deletions}</span>
              </span>
            )}
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <AgentSelect
            value={p.note.agent}
            agents={p.agents}
            onChange={p.onAssign}
            className="w-[168px]"
          />

          <PolicyToggle value={p.note.policy ?? "repo"} onChange={p.onPolicy} disabled={live} />

          {!live && !reviewable && (
            <Button variant="default" onClick={() => p.onRun()} disabled={!p.note.agent}>
              {p.note.status === "failed" ? "Retry" : "Run"}
            </Button>
          )}
          {live && run && (
            <Button onClick={() => p.onCancel(run.id)}>Stop</Button>
          )}
          {p.forge?.available && p.note.branch && !p.note.pr && !live && (
            <Button
              onClick={async () => { setPring(true); await p.onOpenPr(); setPring(false) }}
              disabled={pring}
            >
              {pring ? "Opening…" : "Open PR"}
            </Button>
          )}
          {reviewable && (
            <>
              <Button variant="outline" onClick={() => p.onReview("merge")}>
                {p.note.pr ? "Merge locally" : "Merge"}
              </Button>
              <Button variant="outline" onClick={() => p.onReview("discard")}>Discard</Button>
            </>
          )}
        </div>
      </header>

      {!split && (
        <nav className="flex items-center gap-1 border-y border-hairline px-4 py-1.5">
          {(["stream", "diff"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12.5px] capitalize transition-colors",
                tab === t ? "bg-raised text-ink" : "text-dim hover:text-ink",
              )}
            >
              {t}
              {t === "diff" && p.note.stat && p.note.stat.files > 0 && (
                <span className="ml-1.5 text-[11px] tabular-nums text-faint">{p.note.stat.files}</span>
              )}
            </button>
          ))}
          <button
            onClick={p.onDelete}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-[11.5px] text-faint transition-colors hover:bg-[#241419] hover:text-berry"
          >
            Delete
          </button>
        </nav>
      )}

      <div className={cn("flex min-h-0 flex-1", split && "border-t border-hairline")}>
        {(tab === "stream" || split) && (
          <div className={cn("flex min-w-0 flex-col", split ? "flex-1 border-r border-hairline" : "flex-1")}>
            <Transcript
              key={p.note.id}
              frames={p.frames}
              prompt={p.note.body}
              onEditPrompt={(b) => p.onEdit({ body: b })}
            />
          </div>
        )}
        {(tab === "diff" || split) && (
          <div className={cn("flex min-w-0 flex-col", split ? "flex-[1.25]" : "flex-1")}>
            {diff === null ? (
              <LoadingBlock label="Reading the diff" />
            ) : (
              <DiffView diff={diff.text} capturedAt={diff.capturedAt} />
            )}
          </div>
        )}
      </div>

      {live && p.activity && (
        <div className="border-t border-hairline bg-[#1c180f] px-4 py-2.5">
          <div className="flex items-baseline gap-2.5">
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-lemon">
              {p.activity.tool}
            </span>
            <span className="truncate font-mono text-[11.5px] text-[#b9a06a]" title={p.activity.detail}>
              {p.activity.detail}
            </span>
          </div>
          <ActivityLine className="mt-1.5" />
        </div>
      )}

      <div className="border-t border-hairline p-3">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={live ? "Steer the agent…" : "Say what to change, then send"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
            e.stopPropagation()
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button variant="default" onClick={() => void send()} disabled={!draft.trim() || sending}>
            Send
          </Button>
          <span className="text-[11px] text-faint">{delivery ?? "⌘↵ to send"}</span>
        </div>
      </div>
    </div>
  )

  // Never an overlay. Covering the sidebar to read a diff means losing the one
  // thing the app is for — seeing what else is waiting on you.
  return (
    <aside
      className={cn(
        "bg-card flex shrink-0 flex-col border-l transition-[width] duration-200",
        full ? "w-[min(1000px,62vw)]" : "w-[420px]",
      )}
    >
      {body}
    </aside>
  )
}

function Sep() {
  return <span className="text-faint">·</span>
}

/**
 * The one place we ask the user to accept risk, so it says what the risk is
 * rather than hiding behind a word like "sandbox".
 */
function PolicyToggle({
  value,
  onChange,
  disabled,
}: {
  value: Policy
  onChange: (p: Policy) => void
  disabled: boolean
}) {
  const full = value === "full"
  return (
    <Hint
      text={
        full
          ? "Full access: this agent can run any command, including outside the repo."
          : "Repo only: it can edit files, but most shell commands are refused — including running tests."
      }
    >
      <Button
        variant={full ? "outline" : "ghost"}
        disabled={disabled}
        onClick={() => onChange(full ? "repo" : "full")}
        className={cn(full && "border-[#4a3a20] bg-[#241d10] text-lemon")}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", full ? "bg-lemon" : "bg-faint")} />
        {full ? "Full access" : "Repo only"}
      </Button>
    </Hint>
  )
}
