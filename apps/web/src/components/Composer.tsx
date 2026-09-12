import { useState } from "react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"

/**
 * Writing a note is writing a prompt. The field is the size of the thing you
 * should actually write — a sentence or two of intent, not a paragraph of spec.
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
  onCreate: (title: string, agent: AgentId | null, run: boolean) => void
}) {
  const [text, setText] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")

  const submit = (run: boolean) => {
    const title = text.trim()
    if (!title) return
    onCreate(title, (agent || null) as AgentId | null, run)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 px-6">
      <div className="w-[min(640px,100%)] border border-[#2a2a2a] bg-graphite p-10">
        <h2 className="display display-md">New note</h2>
        <p className="meta mt-3">What should the agent do?</p>

        <Textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Fix the flicker when a note moves between lanes."
          className="mt-8"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel()
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e.shiftKey)
          }}
        />

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentId)}
            className="h-9 rounded-[50px] border border-ash bg-transparent px-5 text-[11px] uppercase text-paper-white"
          >
            <option value="">no agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.installed}>
                {a.id}
                {a.installed ? "" : " — not installed"}
              </option>
            ))}
          </select>

          <Button variant="outline" size="md" onClick={() => submit(false)} disabled={!text.trim()}>
            Add
          </Button>
          <Button
            variant="solid"
            size="md"
            onClick={() => submit(true)}
            disabled={!text.trim() || !agent}
          >
            Add &amp; run
          </Button>
          <span className="meta ml-auto">⌘↵ add · ⇧⌘↵ run · esc</span>
        </div>
      </div>
    </div>
  )
}
