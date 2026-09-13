import { useState } from "react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Button } from "@/ui"
import { Textarea } from "@/ui"

/**
 * Writing a note is writing a prompt. The field is the size of the thing you
 * should actually write — a sentence or two of intent, not a page of spec.
 */
export function Composer({
  agents,
  defaultAgent,
  onCancel,
  onCreate,
}: {
  agents: AgentInfo[]
  defaultAgent: AgentId | null
  onCancel: () => void
  onCreate: (title: string, body: string, agent: AgentId | null, run: boolean) => void
}) {
  const [text, setText] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")

  const submit = (run: boolean) => {
    const [firstLine = "", ...lines] = text.trim().split(/\r?\n/)
    const title = firstLine.trim()
    const body = lines.join("\n").trim()
    if (!title) return
    onCreate(title, body, (agent || null) as AgentId | null, run)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-6 pt-[16vh] backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(620px,100%)] rounded-xl border border-line bg-surface p-5 shadow-2xl shadow-black/60"
      >
        <Textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What should the agent do?"
          className="border-0 bg-transparent px-0 text-[15px] leading-[1.5] focus:border-0"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel()
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentId)}
            className="h-7 rounded-lg border border-line bg-raised px-2 text-[12px] text-ink"
          >
            <option value="">no agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.installed}>
                {a.id}
                {a.installed ? "" : " — not installed"}
              </option>
            ))}
          </select>

          <Button tone="ghost" onClick={() => submit(false)} disabled={!text.trim()}>
            Add
          </Button>
          <Button tone="primary" onClick={() => submit(true)} disabled={!text.trim() || !agent}>
            Add &amp; run
          </Button>
          <span className="ml-auto text-[11px] text-faint">⌘↵ run · ⇧⌘↵ add · esc</span>
        </div>
      </div>
    </div>
  )
}
