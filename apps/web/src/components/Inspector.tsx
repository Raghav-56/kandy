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
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { cn, compact, duration, money } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"
import { AgentMark, agentLabel } from "./AgentMark"
import { DiffView } from "./DiffView"
import { PrBadge } from "./PrBadge"
import { InlineEdit } from "./InlineEdit"
import { Transcript } from "./Transcript"
import { STYLES } from "./status"

type Props = {
  note: Note
  view: BoardView
  agents: AgentInfo[]
  frames: TranscriptFrame[]
  activity: ActivityFrame | undefined
  onEdit: (patch: { title?: string; body?: string }) => Promise<boolean>
  onClose: () => void
  onRun: (agent?: AgentId) => void
  onCancel: (runId: string) => void
  onAssign: (agent: AgentId) => void
  onPolicy: (policy: Policy) => void
  onSteer: (text: string) => Promise<"live" | "queued" | undefined>
  onReview: (decision: "merge" | "discard") => void
  forge: Forge | null
  onOpenPr: () => Promise<void>
  onDelete: () => void
  loadDiff: () => Promise<{ diff: string; capturedAt: number | null } | undefined>
}

export function Inspector(p: Props) {
  const [tab, setTab] = useState<"stream" | "diff">("stream")
  const [diff, setDiff] = useState<{ text: string; capturedAt: number | null } | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<string | null>(null)
  const [pring, setPring] = useState(false)
  // Reviewing a diff needs room; watching a stream does not. One toggle rather
  // than a drag handle, because the two useful widths are the only two anyone
  // actually wants.
  const [wide, setWide] = useState(false)

  const run = p.view.runs.find((r) => r.id === p.note.runId)
  const live = p.note.status === "running" || p.note.status === "blocked"
  const reviewable = p.note.status === "review"
  const s = STYLES[p.note.status]
  useTick(live)

  useEffect(() => {
    setDiff(null)
    if (tab === "diff")
      void p.loadDiff().then((d) => d && setDiff({ text: d.diff, capturedAt: d.capturedAt }))
  }, [tab, p.note.id])

  // Jump to the diff as soon as there is one to judge.
  useEffect(() => {
    if (reviewable) setTab("diff")
  }, [reviewable])

  async function openPr() {
    setPring(true)
    await p.onOpenPr()
    setPring(false)
  }

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const how = await p.onSteer(text)
    setSending(false)
    if (how) {
      setDraft("")
      setDelivery(how === "live" ? "sent to the running agent" : "queued as a follow-up run")
      setTimeout(() => setDelivery(null), 4000)
    }
  }

  const policy = p.note.policy ?? "repo"
  const canOpenPr = Boolean(p.forge?.available && p.note.branch && !p.note.pr)

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-line-soft bg-panel transition-[width]",
        wide ? "w-[min(980px,70vw)]" : "w-[560px]",
      )}
    >
      <header className="px-5 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", s.dot, live && "breathe")}
              />
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                {s.label}
              </span>
              {p.note.agent && (
                <>
                  <span className="text-faint">·</span>
                  <AgentMark agent={p.note.agent} size={12} />
                  <span className="text-[11.5px] text-dim">{agentLabel(p.note.agent)}</span>
                </>
              )}
            </div>
            <h2 className="mt-2.5 text-[17px] font-medium leading-snug tracking-[-0.015em]">
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
            <button
              onClick={() => setWide((w) => !w)}
              aria-label={wide ? "Narrow panel" : "Widen panel"}
              title={wide ? "Narrow" : "Widen — for reading diffs"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel-2 hover:text-ink"
            >
              {wide ? "⇥" : "⇤"}
            </button>
            <button
              onClick={p.onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-dim transition-colors hover:bg-panel-2 hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Metrics inline. A four-column grid looked considered and cost ~90px
            of vertical space in a panel whose actual content is below it. */}
        {run && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-dim">
            <span className={cn("tabular-nums", live && "text-amber")}>
              {duration(run.startedAt, run.endedAt)}
            </span>
            {run.turns !== null && (
              <>
                <Dot />
                <span className="tabular-nums">{run.turns} turns</span>
              </>
            )}
            {run.tokens !== null && (
              <>
                <Dot />
                <span className="tabular-nums">{compact(run.tokens)} tok</span>
              </>
            )}
            {run.costUsd !== null && (
              <>
                <Dot />
                <span className="tabular-nums">{money(run.costUsd)}</span>
              </>
            )}
          </div>
        )}

        {p.note.branch && (
          <div className="mt-3 flex items-center gap-2.5">
            <span className="min-w-0 truncate font-mono text-[11px] text-faint" title={p.note.branch}>
              {p.note.branch}
            </span>
            {p.note.pr && <PrBadge pr={p.note.pr} onDark size="md" />}
            {p.note.stat && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums">
                <span className="text-sage">+{p.note.stat.insertions}</span>{" "}
                <span className="text-coral">−{p.note.stat.deletions}</span>
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={p.note.agent ?? ""}
            onChange={(e) => p.onAssign(e.target.value as AgentId)}
            className="h-8 rounded-lg border border-line bg-panel-2 px-2.5 text-[12px] text-ink"
          >
            <option value="" disabled>
              agent
            </option>
            {p.agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.installed}>
                {agentLabel(a.id)}
                {a.installed ? "" : " — not installed"}
              </option>
            ))}
          </select>

          <PolicyToggle value={policy} onChange={p.onPolicy} disabled={live} />

          {!live && !reviewable && (
            <Button variant="solid" size="md" onClick={() => p.onRun()} disabled={!p.note.agent}>
              {p.note.status === "failed" ? "Retry" : "Run"}
            </Button>
          )}
          {live && run && (
            <Button variant="outline" size="md" onClick={() => p.onCancel(run.id)}>
              Stop
            </Button>
          )}
          {canOpenPr && !live && (
            <Button variant="outline" size="md" onClick={() => void openPr()} disabled={pring}>
              {pring ? "Opening…" : "Open PR"}
            </Button>
          )}
          {reviewable && (
            <>
              <Button variant="solid" size="md" onClick={() => p.onReview("merge")}>
                {p.note.pr ? "Merge locally" : "Merge"}
              </Button>
              <Button variant="danger" size="md" onClick={() => p.onReview("discard")}>
                Discard
              </Button>
            </>
          )}

        </div>
      </header>

      <nav className="flex items-center gap-1 border-y border-line-soft px-4 py-2">
        {(["stream", "diff"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12.5px] capitalize transition-colors",
              tab === t ? "bg-panel-2 text-ink" : "text-dim hover:text-ink",
            )}
          >
            {t}
            {t === "diff" && p.note.stat && p.note.stat.files > 0 && (
              <span className="ml-1.5 text-[11px] tabular-nums text-faint">
                {p.note.stat.files}
              </span>
            )}
          </button>
        ))}

        {/* Destructive, and never competing with the review verdict. */}
        <button
          onClick={p.onDelete}
          className="ml-auto rounded-lg px-2.5 py-1.5 text-[11.5px] text-faint transition-colors hover:bg-[#1d1312] hover:text-coral"
        >
          Delete note
        </button>
      </nav>

      {tab === "stream" ? (
        <Transcript
          key={p.note.id}
          frames={p.frames}
          prompt={p.note.body}
          onEditPrompt={(body) => p.onEdit({ body })}
        />
      ) : diff === null ? (
        <p className="flex-1 px-5 py-6 text-center text-[12px] text-faint">Loading…</p>
      ) : (
        <DiffView diff={diff.text} capturedAt={diff.capturedAt} />
      )}

      {/* What it is doing, pinned just above where you would interrupt it. */}
      {live && p.activity && <ActivityStrip tool={p.activity.tool} detail={p.activity.detail} />}

      {/* Steering: the point of a board you can walk up to mid-run. */}
      <div className="border-t border-line-soft p-3">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={live ? "Steer the agent…" : "Say what to change, then send"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button variant="solid" onClick={() => void send()} disabled={!draft.trim() || sending}>
            Send
          </Button>
          <span className="text-[11px] text-faint">{delivery ?? "⌘↵ to send"}</span>
        </div>
      </div>
    </aside>
  )
}

function Dot() {
  return <span className="text-faint">·</span>
}

/**
 * Live activity as a strip, not a dot.
 *
 * A pulsing dot says "something is happening" and nothing else — which you
 * already knew from the status. What you actually want is the verb and its
 * object: which tool, on what. The shimmer carries the liveness so the text
 * can carry the meaning.
 */
function ActivityStrip({ tool, detail }: { tool: string; detail: string }) {
  return (
    <div className="relative overflow-hidden border-t border-line-soft bg-[#14110b] px-4 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-amber">
          {tool}
        </span>
        <span className="truncate font-mono text-[11.5px] text-[#b39456]" title={detail}>
          {detail}
        </span>
      </div>
      <span className="shimmer pointer-events-none absolute inset-x-0 bottom-0 h-px" />
    </div>
  )
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
    <button
      disabled={disabled}
      onClick={() => onChange(full ? "repo" : "full")}
      title={
        full
          ? "Full access: the agent can run any command, including outside this repo. Click to restrict."
          : "Repo only: the agent can edit files, but most shell commands are refused — including running tests. Click to allow everything."
      }
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] transition-colors disabled:opacity-40",
        full
          ? "border-[#4a3a20] bg-[#1f1810] text-amber"
          : "border-line bg-panel-2 text-dim hover:text-ink",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", full ? "bg-amber" : "bg-[#3a3a42]")} />
      {full ? "Full access" : "Repo only"}
    </button>
  )
}

