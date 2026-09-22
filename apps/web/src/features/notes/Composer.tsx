import { useRef, useState } from "react"
import { Paperclip } from "lucide-react"
import { splitPrompt, type AgentId, type AgentInfo } from "@kandy/core"
import { Button, Dialog, DialogContent, DialogTitle, Kbd, Textarea } from "@/ui"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { ModelSelect } from "@/features/agents/ModelSelect"
import { Attachments, type Attached } from "@/features/notes/Attachments"

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
  initialTitle = "",
  onCancel,
  onCreate,
}: {
  agents: AgentInfo[]
  defaultAgent: AgentId | null
  /** A one-liner already typed into the board's bar, carried over on expand. */
  initialTitle?: string
  onCancel: () => void
  onCreate: (
    title: string,
    body: string,
    agent: AgentId | null,
    model: string | null,
    run: boolean,
    files: Attached[],
  ) => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState("")
  const [agent, setAgent] = useState<AgentId | "">(defaultAgent ?? "")
  const [model, setModel] = useState<string | null>(null)
  const [files, setFiles] = useState<Attached[]>([])
  const detail = useRef<HTMLTextAreaElement>(null)

  const submit = (run: boolean) => {
    const t = title.trim()
    if (!t) return
    onCreate(t, body.trim(), (agent || null) as AgentId | null, model, run, files)
  }

  /**
   * A paste into the single-line title.
   *
   * Pasting a paragraph into an <input> keeps the first line and throws the
   * rest away without saying so. A note is already a first line plus a
   * remainder, so the paste is split the way `promptFor` would have joined it:
   * line one titles the note, everything after it lands in the detail. A
   * single-line paste is left to the browser.
   */
  function pasteIntoTitle(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain")
    if (!text.includes("\n") && !text.includes("\r")) return

    e.preventDefault()
    const split = splitPrompt(text)
    const el = e.currentTarget
    const before = title.slice(0, el.selectionStart ?? title.length)
    const after = title.slice(el.selectionEnd ?? title.length)
    setTitle((before + split.title + after).trim())
    if (split.body) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${split.body}` : split.body))
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="top-[16vh] grid-cols-[minmax(0,1fr)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[660px]"
      >
        {/* Present for screen readers; the placeholder is the visible prompt. */}
        <DialogTitle className="sr-only">New note</DialogTitle>

        {/*
          One drop target around everything, so the paperclip can sit with the
          other controls — `bare` hands over `open` and leaves the placement to
          us. It used to render its own "Attach" on a row of its own beneath an
          empty textarea, stranded from the controls it belongs with; the
          board's composer already keeps its paperclip beside send.
        */}
        <Attachments files={files} onChange={setFiles} bare>
          {({ onPaste, open }) => (
            <>
              {/* No box around these. An outline turns the room left for typing
                  into a visible empty rectangle; a hairline between the two
                  fields says "separate" without fencing in whitespace. */}
              <div className="px-5 pt-5 pb-3">
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onPaste={(e) => {
                    onPaste(e)
                    if (!e.defaultPrevented) pasteIntoTitle(e)
                  }}
                  placeholder="What should the agent do?"
                  className="placeholder:text-muted-foreground/40 w-full bg-transparent py-1.5 text-lede font-medium tracking-[-0.015em] outline-none placeholder:font-normal"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault()
                      detail.current?.focus()
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
                    e.stopPropagation()
                  }}
                />

                <div className="bg-hairline my-2 h-px" />

                {/*
                  The base Textarea is a bordered field with its own padding and
                  a dark-mode fill. Here it continues the title above it, so all
                  three go — including `dark:bg-input/30`, which `bg-transparent`
                  alone does not outrank.
                */}
                <Textarea
                  ref={detail}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onPaste={onPaste}
                  placeholder="Constraints, how to verify — optional"
                  className="placeholder:text-muted-foreground/40 min-h-[72px] resize-none border-0 bg-transparent p-0 py-1 text-title leading-[1.6] shadow-none focus-visible:ring-0 dark:bg-transparent"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(!e.shiftKey)
                    e.stopPropagation()
                  }}
                />
              </div>

              {/*
                One row of controls, on the same 20px gutter as the fields above
                — it was 16px, so neither edge of the row lined up with the text
                it sits under. And one type size across it: the pickers were
                14px beside 12px buttons.

                The shortcuts live on the buttons they trigger rather than in a
                third bordered strip of their own. Escape is not spelled out:
                every dialog closes on it.
              */}
              <div className="bg-muted/50 flex flex-wrap items-center gap-2 border-t px-5 py-3">
                <button
                  type="button"
                  onClick={open}
                  aria-label="Attach files"
                  title="Attach files — or paste a screenshot"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground -ml-1.5 grid size-7 shrink-0 place-items-center rounded-lg transition-colors"
                >
                  <Paperclip className="size-4" />
                </button>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => submit(false)}
                    disabled={!title.trim()}
                    title="Save without running — ⇧⌘↵"
                  >
                    Save
                  </Button>
                  <Button size="sm" onClick={() => submit(true)} disabled={!title.trim() || !agent}>
                    Save &amp; run
                    <Kbd className="bg-primary-foreground/15 text-primary-foreground/80 ml-0.5 border-0">⌘↵</Kbd>
                  </Button>
                </div>
              </div>
            </>
          )}
        </Attachments>
      </DialogContent>
    </Dialog>
  )
}
