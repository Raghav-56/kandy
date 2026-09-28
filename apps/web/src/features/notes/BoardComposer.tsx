import { useEffect, useRef, useState } from "react"
import { Maximize2 } from "lucide-react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Hint } from "@/ui"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { defaultModelLabel, ModelSelect } from "@/features/agents/ModelSelect"
import { PromptBox } from "@/features/notes/PromptBox"
import type { Attached } from "@/features/notes/Attachments"
import { useIsMobile } from "@/hooks/use-mobile"

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
  boardModels,
}: {
  agents: AgentInfo[]
  defaultAgent: AgentId | null
  /** Resolves true once the note exists; until then the draft is kept. */
  onCreate: (
    title: string,
    agent: AgentId | null,
    model: string | null,
    files: Attached[],
  ) => Promise<boolean>
  /** Hand the draft to the full composer, rather than throwing it away. */
  onExpand: (draft: string) => void
  paths: { files: string[]; dirs: string[] }
  /** The board's per-agent model seeds, so "default" can say what it means. */
  boardModels?: Partial<Record<AgentId, string>> | undefined
}) {
  const [draft, setDraft] = useState("")
  /*
   * Only what you chose. The default is not copied into state: after a reload
   * the agent list arrives after this mounts, and a default read once at mount
   * was still null — so the bar said "Choose an agent" and ⌘↵ only saved.
   * Deriving it means the default lands whenever it is known, and never
   * overrides a choice you made.
   */
  const [picked, setPicked] = useState<AgentId | null>(null)
  const agent = picked ?? defaultAgent
  const [model, setModel] = useState<string | null>(null)
  const [files, setFiles] = useState<Attached[]>([])
  const [sending, setSending] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const phone = useIsMobile()

  const submit = async () => {
    const title = draft.trim()
    if (!title || sending) return
    setSending(true)
    try {
      // Cleared only once the note exists: a daemon that was down used to
      // take the text with it.
      if (await onCreate(title, agent, model, files)) {
        setDraft("")
        setFiles([])
      }
    } finally {
      setSending(false)
    }
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
            onSubmit={() => void submit()}
            busy={sending}
            files={files}
            onFiles={setFiles}
            rows={1}
            maxRows={8}
            paths={paths}
            /* The @ tip only where it fits on one line: on a phone it wrapped,
               and the second line was clipped behind a scrollbar. */
            placeholder={
              paths.files.length > 0 && !phone
                ? "What should the agent do?  @ to point at a file"
                : "What should the agent do?"
            }
            controls={
              <>
                <AgentSelect
                  value={agent}
                  agents={agents}
                  onChange={setPicked}
                  className="h-7 w-[132px] border-0 bg-transparent text-aux"
                />
                <ModelSelect
                  agent={agent}
                  value={model}
                  onChange={setModel}
                  placeholder={defaultModelLabel(boardModels, agent)}
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
