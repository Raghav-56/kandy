import { useState } from "react"
import { CornerDownLeft } from "lucide-react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Button, Kbd, Textarea } from "@/ui"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { ModelSelect } from "@/features/agents/ModelSelect"

/**
 * Writing a note is writing a prompt.
 *
 * One writing surface, not a form: the first line becomes the title and the
 * rest becomes the prompt, which is the same rule the CLI uses, so a note reads
 * the same wherever it was written. Everything else sits on one row underneath
 * and is optional.
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
  onCreate: (
    title: string,
    body: string,
    agent: AgentId | null,
    model: string | null,
    run: boolean,
  ) => void
}) {
  const [text, setText] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")
  const [model, setModel] = useState<string | null>(null)

  const [firstLine = "", ...restLines] = text.trim().split(/\r?\n/)
  const title = firstLine.trim()
  const body = restLines.join("\n").trim()

  const submit = (run: boolean) => {
    if (!title) return
    onCreate(title, body, (agent || null) as AgentId | null, model, run)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-6 pt-[13vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="rise bg-card w-[min(680px,100%)] overflow-hidden rounded-2xl border shadow-2xl shadow-black/50">
        <div className="px-4 pt-4">
          <Textarea
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What should the agent do?"
            className="resize-none border-0 bg-transparent px-0 text-[15px] leading-[1.55] shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel()
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
              e.stopPropagation()
            }}
          />

          {/* Say what the split will do, once there is something to split. */}
          {body && (
            <p className="text-muted-foreground/70 mt-1 text-[11px]">
              First line is the title; the rest is the prompt.
            </p>
          )}
        </div>

        <div className="bg-muted/40 mt-3 flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <AgentSelect
            value={agent || null}
            agents={agents}
            onChange={setAgent}
            className="w-[150px]"
          />
          <ModelSelect
            agent={agent || null}
            value={model}
            onChange={setModel}
            className="w-[176px]"
          />

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => submit(false)} disabled={!title}>
              Save
            </Button>
            <Button size="sm" onClick={() => submit(true)} disabled={!title || !agent}>
              Save &amp; run
              <CornerDownLeft className="size-3 opacity-70" />
            </Button>
          </div>
        </div>

        <div className="text-muted-foreground/60 flex items-center gap-3 border-t px-4 py-2 text-[11px]">
          <span className="flex items-center gap-1">
            <Kbd>⌘↵</Kbd> save &amp; run
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧⌘↵</Kbd> save
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> cancel
          </span>
        </div>
      </div>
    </div>
  )
}
