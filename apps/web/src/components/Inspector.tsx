import { useEffect, useRef, useState } from "react"
import type { AgentId, AgentInfo, BoardView, Note, Policy, TranscriptFrame } from "@kandy/core"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { cn, relTime } from "@/lib/utils"
import { STYLES } from "./status"

type Props = {
  note: Note
  view: BoardView
  agents: AgentInfo[]
  frames: TranscriptFrame[]
  onClose: () => void
  onRun: (agent?: AgentId) => void
  onCancel: (runId: string) => void
  onAssign: (agent: AgentId) => void
  onPolicy: (policy: Policy) => void
  onSteer: (text: string) => Promise<"live" | "queued" | undefined>
  onReview: (decision: "merge" | "discard") => void
  onDelete: () => void
  loadDiff: () => Promise<{ diff: string; stat: string } | undefined>
}

export function Inspector(p: Props) {
  const [tab, setTab] = useState<"stream" | "diff">("stream")
  const [diff, setDiff] = useState<{ diff: string; stat: string } | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<string | null>(null)

  const run = p.view.runs.find((r) => r.id === p.note.runId)
  const live = p.note.status === "running" || p.note.status === "blocked"
  const reviewable = p.note.status === "review"
  const s = STYLES[p.note.status]

  useEffect(() => {
    setDiff(null)
    if (tab === "diff") void p.loadDiff().then((d) => d && setDiff(d))
  }, [tab, p.note.id])

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

  return (
    <aside className="flex h-full w-[440px] shrink-0 flex-col border-l border-line-soft bg-panel">
      <header className="border-b border-line-soft px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  s.dot,
                  p.note.status === "running" && "breathe",
                )}
              />
              <span className="label">{s.label}</span>
              {run && <span className="label">· {relTime(run.startedAt)} ago</span>}
            </div>
            <h2 className="mt-2 text-[15px] font-medium leading-snug">{p.note.title}</h2>
          </div>
          <button
            onClick={p.onClose}
            className="-mr-1 -mt-1 h-7 w-7 rounded-md text-faint transition-colors hover:bg-panel-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {p.note.branch && (
          <div className="mt-3 truncate font-mono text-[11px] text-faint">{p.note.branch}</div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <select
            value={p.note.agent ?? ""}
            onChange={(e) => p.onAssign(e.target.value as AgentId)}
            className="h-7 rounded-lg border border-line bg-panel-2 px-2 text-[12px] text-ink"
          >
            <option value="" disabled>
              agent
            </option>
            {p.agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.installed}>
                {a.id}
                {a.installed ? "" : " — not installed"}
              </option>
            ))}
          </select>

          <PolicyToggle value={p.note.policy ?? "repo"} onChange={p.onPolicy} disabled={live} />

          {!live && !reviewable && (
            <Button variant="solid" onClick={() => p.onRun()} disabled={!p.note.agent}>
              {p.note.status === "failed" ? "Retry" : "Run"}
            </Button>
          )}
          {live && run && (
            <Button variant="outline" onClick={() => p.onCancel(run.id)}>
              Stop
            </Button>
          )}
          {reviewable && (
            <>
              <Button variant="solid" onClick={() => p.onReview("merge")}>
                Merge
              </Button>
              <Button variant="danger" onClick={() => p.onReview("discard")}>
                Discard
              </Button>
            </>
          )}

          <button
            onClick={p.onDelete}
            className="ml-auto text-[11.5px] text-faint transition-colors hover:text-coral"
          >
            Delete
          </button>
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-line-soft px-3 py-1.5">
        {(["stream", "diff"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] capitalize transition-colors",
              tab === t ? "bg-panel-2 text-ink" : "text-dim hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "stream" ? <Stream frames={p.frames} body={p.note.body} /> : <Diff diff={diff} />}

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
          : "Repo only: the agent can edit files but most shell commands are refused — including running tests. Click to allow everything."
      }
      className={cn(
        "h-7 rounded-lg border px-2.5 text-[11.5px] transition-colors disabled:opacity-40",
        full
          ? "border-[#4a3a20] bg-[#1f1810] text-amber"
          : "border-line bg-panel-2 text-dim hover:text-ink",
      )}
    >
      {full ? "full access" : "repo only"}
    </button>
  )
}

function Stream({ frames, body }: { frames: TranscriptFrame[]; body: string }) {
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    // Only autoscroll when already at the bottom. Yanking someone back down
    // while they're reading is the rudest thing a log can do.
    if (pinned) end.current?.scrollIntoView({ block: "end" })
  }, [frames.length, pinned])

  return (
    <div
      ref={box}
      onScroll={() => {
        const el = box.current
        if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
      }}
      className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
    >
      {body && (
        <div className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2.5">
          <div className="label">prompt</div>
          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-dim">
            {body}
          </p>
        </div>
      )}

      {frames.length === 0 && <p className="text-[12px] text-faint">Nothing yet.</p>}

      {frames.map((f) => {
        const denied = f.meta === "permission"
        return (
          <div key={`${f.runId}-${f.seq}`} className="space-y-1">
            {f.role !== "assistant" && (
              <div
                className={cn(
                  "label",
                  f.role === "error" && "text-coral",
                  denied && "text-coral",
                  f.role === "user" && "text-azure",
                )}
              >
                {f.role === "tool" ? (f.meta ?? "tool") : denied ? "denied" : f.role}
              </div>
            )}
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-[12.5px] leading-relaxed",
                f.role === "assistant" && "text-ink",
                f.role === "user" && "rounded-lg border border-[#22304d] bg-[#141a26] px-2.5 py-2 text-[#c7d6f5]",
                // Clamp rather than truncate: tool arguments are often long
                // paths, and one line of a path tells you nothing.
                f.role === "tool" && "line-clamp-2 font-mono text-[11.5px] text-faint",
                f.role === "system" && "text-dim",
                (f.role === "error" || denied) &&
                  "rounded-lg border border-[#3d2621] bg-[#1d1312] px-2.5 py-2 text-[#e8b3a8]",
              )}
            >
              {f.text}
            </p>
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function Diff({ diff }: { diff: { diff: string; stat: string } | null }) {
  if (!diff) return <p className="flex-1 px-5 py-4 text-[12px] text-faint">Loading…</p>
  if (!diff.diff.trim())
    return <p className="flex-1 px-5 py-4 text-[12px] text-faint">No changes yet.</p>

  return (
    <div className="flex-1 overflow-auto px-5 py-4">
      <pre className="mb-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-dim">
        {diff.stat}
      </pre>
      <pre className="font-mono text-[11px] leading-[1.55]">
        {diff.diff.split("\n").map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all px-1",
              l.startsWith("+") && !l.startsWith("+++") && "bg-[#12210f] text-[#a5d68f]",
              l.startsWith("-") && !l.startsWith("---") && "bg-[#22100f] text-[#e0918a]",
              l.startsWith("@@") && "mt-2 text-azure",
              l.startsWith("diff ") && "mt-3 font-semibold text-ink",
            )}
          >
            {l || " "}
          </div>
        ))}
      </pre>
    </div>
  )
}
