import { useEffect, useRef, useState } from "react"
import type { AgentId, AgentInfo, BoardView, Note, TranscriptFrame } from "@kandy/core"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { cn, relTime } from "@/lib/utils"

type Props = {
  note: Note
  view: BoardView
  agents: AgentInfo[]
  frames: TranscriptFrame[]
  onClose: () => void
  onRun: (agent?: AgentId) => void
  onCancel: (runId: string) => void
  onAssign: (agent: AgentId) => void
  onSteer: (text: string) => Promise<"live" | "queued" | undefined>
  onReview: (decision: "merge" | "discard", comment?: string) => void
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

  useEffect(() => {
    if (tab === "diff") void p.loadDiff().then((d) => d && setDiff(d))
    // Re-fetch when the note changes so the panel never shows a stale diff.
  }, [tab, p.note.id])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const how = await p.onSteer(text)
    setSending(false)
    if (how) {
      setDraft("")
      setDelivery(how === "live" ? "delivered to the running agent" : "queued as a follow-up run")
      setTimeout(() => setDelivery(null), 4000)
    }
  }

  return (
    <aside className="flex h-full w-[460px] shrink-0 flex-col border-l border-[#1c1c1c] bg-obsidian">
      <header className="flex items-start gap-4 border-b border-[#1c1c1c] px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="display display-xs text-ash">{p.note.status}</div>
          <h2 className="display display-md mt-2 break-words">{p.note.title}</h2>
          {p.note.branch && (
            <div className="meta mt-3 truncate font-mono">{p.note.branch}</div>
          )}
        </div>
        <button onClick={p.onClose} className="display display-sm text-ash hover:text-paper-white">
          ✕
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#1c1c1c] px-6 py-4">
        <select
          value={p.note.agent ?? ""}
          onChange={(e) => p.onAssign(e.target.value as AgentId)}
          className="h-7 rounded-[50px] border border-ash bg-transparent px-4 text-[11px] uppercase text-paper-white"
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

        {!live && !reviewable && (
          <Button variant="solid" onClick={() => p.onRun()} disabled={!p.note.agent}>
            Run
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
            <Button variant="outline" onClick={() => p.onReview("discard")}>
              Discard
            </Button>
          </>
        )}
        <button
          onClick={p.onDelete}
          className="ml-auto text-[11px] uppercase text-smoke hover:text-paper-white"
        >
          Delete
        </button>
      </div>

      <nav className="flex gap-6 border-b border-[#1c1c1c] px-6">
        {(["stream", "diff"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "display display-xs -mb-px border-b py-3",
              tab === t ? "border-paper-white text-paper-white" : "border-transparent text-smoke",
            )}
          >
            {t}
          </button>
        ))}
        {run && (
          <span className="meta ml-auto self-center">
            {run.agentSessionId ? "session live" : "no session"} · {relTime(run.startedAt)} ago
          </span>
        )}
      </nav>

      {tab === "stream" ? (
        <Stream frames={p.frames} body={p.note.body} />
      ) : (
        <Diff diff={diff} />
      )}

      {/* Steering. The whole point of a board you can walk up to mid-run. */}
      <div className="border-t border-[#1c1c1c] px-6 py-4">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={live ? "Steer the agent…" : "Say what to change, then send"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button variant="solid" onClick={() => void send()} disabled={!draft.trim() || sending}>
            Send
          </Button>
          <span className="meta">{delivery ?? "⌘↵ to send"}</span>
        </div>
      </div>
    </aside>
  )
}

function Stream({ frames, body }: { frames: TranscriptFrame[]; body: string }) {
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    // Only autoscroll if the user is already at the bottom. Yanking someone
    // back down while they're reading is the rudest thing a log can do.
    if (pinned) end.current?.scrollIntoView({ block: "end" })
  }, [frames.length, pinned])

  return (
    <div
      ref={box}
      onScroll={() => {
        const el = box.current
        if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
      }}
      className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
    >
      {body && (
        <div className="border-l border-ash pl-4">
          <div className="display display-xs text-smoke">Prompt</div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#d4d4d4]">
            {body}
          </p>
        </div>
      )}

      {frames.length === 0 && <p className="meta">Nothing yet.</p>}

      {frames.map((f) => (
        <div key={`${f.runId}-${f.seq}`}>
          <div
            className={cn(
              "display display-xs",
              f.role === "error" ? "text-paper-white" : "text-smoke",
            )}
          >
            {f.role === "tool" ? (f.meta ?? "tool") : f.role}
            {f.meta === "permission" && " · denied"}
          </div>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed",
              f.role === "assistant" && "text-paper-white",
              f.role === "user" && "text-[#d4d4d4] italic",
              f.role === "tool" && "font-mono text-[12px] text-ash",
              f.role === "system" && "text-ash",
              // Errors and denials invert: the loudest the palette gets.
              f.role === "error" && "bg-paper-white px-2 py-1 text-obsidian",
            )}
          >
            {f.text}
          </p>
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

function Diff({ diff }: { diff: { diff: string; stat: string } | null }) {
  if (!diff) return <p className="meta flex-1 px-6 py-5">Loading…</p>
  if (!diff.diff.trim()) return <p className="meta flex-1 px-6 py-5">No changes yet.</p>

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      <pre className="meta mb-4 whitespace-pre-wrap text-[#d4d4d4]">{diff.stat}</pre>
      <pre className="font-mono text-[11px] leading-[1.5]">
        {diff.diff.split("\n").map((l, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              // Additions and deletions separate by value, not by red/green.
              l.startsWith("+") && !l.startsWith("+++") && "bg-[#1c1c1c] text-paper-white",
              l.startsWith("-") && !l.startsWith("---") && "text-smoke line-through",
              l.startsWith("@@") && "mt-2 text-ash",
              l.startsWith("diff ") && "mt-4 text-paper-white",
            )}
          >
            {l || " "}
          </div>
        ))}
      </pre>
    </div>
  )
}
