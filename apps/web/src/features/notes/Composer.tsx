import { useRef, useState } from "react"
import { CornerDownLeft } from "lucide-react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Button, Dialog, DialogContent, DialogTitle, Kbd, Textarea } from "@/ui"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { ModelSelect } from "@/features/agents/ModelSelect"

/**
 * Writing a note is writing a prompt.
 *
 * Two named fields rather than one box split on a newline. The split was
 * invisible magic — you could not tell what you were defining until after you
 * had typed it — and the agent is given both, so the distinction is about what
 * shows in the list, not about what gets sent.
 *
 * Built on the same Dialog as every other modal — the hand-rolled overlay it
 * used to have had its own dimming, its own animation and no focus trap, and
 * sat so close in tone to the dimmed board behind it that it barely read as a
 * layer at all.
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
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")
  const [model, setModel] = useState<string | null>(null)
  const detail = useRef<HTMLTextAreaElement>(null)

  const submit = (run: boolean) => {
    const t = title.trim()
    if (!t) return
    onCreate(t, body.trim(), (agent || null) as AgentId | null, model, run)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="top-[16vh] grid-cols-[minmax(0,1fr)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[660px]"
      >
        {/* Present for screen readers; the placeholder is the visible prompt. */}
        <DialogTitle className="sr-only">New note</DialogTitle>

        <div className="space-y-3 px-5 pt-5 pb-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should the agent do?"
            className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] font-medium tracking-[-0.01em] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                detail.current?.focus()
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
              e.stopPropagation()
            }}
          />

          <Textarea
            ref={detail}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Detail — constraints, how to verify it, anything the agent needs. Optional."
            className="min-h-[92px] resize-none border-0 bg-transparent p-0 text-[13.5px] leading-[1.6] shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
              e.stopPropagation()
            }}
          />
        </div>

        <div className="bg-muted/50 flex flex-wrap items-center gap-2 border-t px-4 py-3">
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
            <Button variant="ghost" size="sm" onClick={() => submit(false)} disabled={!title.trim()}>
              Save
            </Button>
            <Button size="sm" onClick={() => submit(true)} disabled={!title.trim() || !agent}>
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
      </DialogContent>
    </Dialog>
  )
}
