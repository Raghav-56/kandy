import { useEffect, useRef, useState } from "react"
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
  paths,
}: {
  agents: AgentInfo[]
  defaultAgent: AgentId | null
  onCreate: (title: string, agent: AgentId | null, model: string | null, files: Attached[]) => void
  /** Hand the draft to the full composer, rather than throwing it away. */
  onExpand: (draft: string) => void
  paths: { files: string[]; dirs: string[] }
}) {
  const [draft, setDraft] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")
  const [model, setModel] = useState<string | null>(null)
  const [files, setFiles] = useState<Attached[]>([])
  const bar = useRef<HTMLDivElement>(null)

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    onCreate(title, (agent || null) as AgentId | null, model, files)
    setDraft("")
    setFiles([])
  }

  /*
   * How tall this is, published for the list to fade against.
   *
   * The list used to be hidden under an opaque band and a gradient scrim
   * painted in the page colour. That did dissolve the rows — and it also
   * painted over the backdrop, so the haze stopped dead at the composer and
   * everything below the input box was flat. The list now masks itself
   * instead, which needs to know where this bar starts.
   */
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const publish = () =>
      document.documentElement.style.setProperty("--composer-h", `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty("--composer-h")
    }
  }, [])

  return (
    // Absolutely positioned over the list, on a frosted shelf of its own.
    <div ref={bar} className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/*
       * The shelf. It blurs what is behind it rather than painting over it, so
       * the rows sliding under the bar go soft and the haze stays — separation
       * without a band of flat colour across the desk.
       *
       * The mask ramps the blur in from nothing at the top: a blur that starts
       * at full strength draws a hard horizontal line of its own, which is the
       * thing this is here to avoid. It reaches above this element because the
       * ramp needs somewhere to happen before the box begins.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 bottom-0 backdrop-blur-[14px] [mask-image:linear-gradient(to_bottom,transparent,#000_58%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_58%)]"
      />
      <div className="relative px-4 pb-4">
        <div className="pointer-events-auto mx-auto w-full max-w-[820px]">
          <PromptBox
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            files={files}
            onFiles={setFiles}
            rows={1}
            maxRows={8}
            paths={paths}
            placeholder={
              paths.files.length > 0
                ? "What should the agent do?  @ to point at a file"
                : "What should the agent do?"
            }
            controls={
              <>
                <AgentSelect
                  value={agent || null}
                  agents={agents}
                  onChange={setAgent}
                  className="h-7 w-[132px] border-0 bg-transparent text-aux"
                />
                <ModelSelect
                  agent={agent || null}
                  value={model}
                  onChange={setModel}
                  className="h-7 w-[150px] border-0 bg-transparent text-aux"
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
