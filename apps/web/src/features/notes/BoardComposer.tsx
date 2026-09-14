import { useState } from "react"
import { Maximize2 } from "lucide-react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Hint } from "@/ui"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { ModelSelect } from "@/features/agents/ModelSelect"
import { PromptBox } from "@/features/notes/PromptBox"
import type { Attached } from "@/features/notes/Attachments"

/**
 * The board's own composer, pinned to the bottom.
 *
 * It sits where your hands already are once you have read the list, and in the
 * same place as the box for steering a run — which makes the two one idea
 * rather than two unrelated inputs that happen to talk to agents.
 *
 * This one is for the one-liner. Anything with real detail — constraints, how
 * to verify, a pasted stack trace — still wants the modal, which has a second
 * field for exactly that; the expand control hands the draft over rather than
 * making you retype it.
 */
export function BoardComposer({
  agents,
  defaultAgent,
  onCreate,
  onExpand,
}: {
  agents: AgentInfo[]
  defaultAgent: AgentId | null
  onCreate: (title: string, agent: AgentId | null, model: string | null, files: Attached[]) => void
  /** Hand the draft to the full composer, rather than throwing it away. */
  onExpand: (draft: string) => void
}) {
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")
  const [model, setModel] = useState<string | null>(null)
  const [files, setFiles] = useState<Attached[]>([])

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    onCreate(title, (agent || null) as AgentId | null, model, files)
    setDraft("")
    setFiles([])
  }

  return (
    /*
     * Absolutely positioned over the list, with the fade above it so rows
     * dissolve rather than being cut in half at the bar's edge. The list
     * carries bottom padding to match, or the last note hides under this.
     */
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      <div className="from-bg h-12 bg-gradient-to-t to-transparent" />
      <div className="bg-bg px-4 pb-4">
        <div className="pointer-events-auto mx-auto w-full max-w-[820px]">
          <PromptBox
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            files={files}
            onFiles={setFiles}
            rows={1}
            maxRows={8}
            placeholder="What should the agent do?"
            controls={
              <>
                <AgentSelect
                  value={agent || null}
                  agents={agents}
                  onChange={setAgent}
                  className="h-7 w-[132px] border-0 bg-transparent text-[12px]"
                />
                <ModelSelect
                  agent={agent || null}
                  value={model}
                  onChange={setModel}
                  className="h-7 w-[150px] border-0 bg-transparent text-[12px]"
                />
                <Hint text="Write it with detail">
                  <button
                    type="button"
                    onClick={() => onExpand(draft)}
                    aria-label="Open the full composer"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-7 place-items-center rounded-lg transition-colors"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                </Hint>
              </>
            }
            hint={agent ? "⌘↵ to run" : "⌘↵ to save"}
          />
        </div>
      </div>
    </div>
  )
}
