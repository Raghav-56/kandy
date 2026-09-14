import { useEffect, useRef } from "react"
import { ArrowUp, Paperclip } from "lucide-react"
import { Attachments, type Attached } from "@/features/notes/Attachments"
import { cn } from "@/lib/utils"

/**
 * Telling an agent what to do, wherever you happen to be doing it.
 *
 * There were two of these. Writing a note was a modal at the top of the board;
 * steering a run was a bordered textarea and a "Send" button at the bottom of
 * the detail pane. Same act, two designs, and nothing to say they were the
 * same act — so this is one component that both use.
 *
 * One container holds both tiers. The controls sit *inside* it rather than in
 * a footer band with its own background, because the agent, the model and the
 * permission are part of the instruction, not chrome around it. Whatever a
 * caller needs there goes in `controls`; this component owns the text, the
 * attachments and the send.
 */
export function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  files,
  onFiles,
  controls,
  hint,
  busy,
  autoFocus,
  rows = 2,
  maxRows = 12,
  className,
}: {
  value: string
  onChange: (v: string) => void
  /** Called on ⌘↵ and on the send button. Nothing is sent while empty. */
  onSubmit: () => void
  placeholder: string
  files: Attached[]
  onFiles: (f: Attached[]) => void
  /** Agent, model, permission — whatever this context lets you set. */
  controls?: React.ReactNode
  /** Replaces the ⌘↵ hint while there is something better to say. */
  hint?: string | null
  busy?: boolean
  autoFocus?: boolean
  rows?: number
  maxRows?: number
  className?: string
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const empty = !value.trim() && files.length === 0

  /*
   * Grow with the text, up to a point.
   *
   * A fixed two-row box means writing anything real happens through a
   * viewport the size of a tweet. Height is reset before it is measured,
   * or the box can only ever get taller.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows)}px`
  }, [value, maxRows])

  return (
    <div
      className={cn(
        "border-line bg-surface rounded-2xl border shadow-lg shadow-black/5",
        "focus-within:border-grape/45 focus-within:ring-grape/12 transition-colors focus-within:ring-3",
        className,
      )}
    >
      <Attachments files={files} onChange={onFiles} bare>
        {({ onPaste, open }) => (
          <div className="flex items-end gap-2 px-3 pt-2.5 pb-1.5">
            <textarea
              ref={box}
              rows={rows}
              autoFocus={autoFocus}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={onPaste}
              placeholder={placeholder}
              className="placeholder:text-muted-foreground/45 min-h-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-[1.55] outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (!empty && !busy) onSubmit()
                }
                // The board listens for j/k/c; typing must not steer it.
                e.stopPropagation()
              }}
            />

            <button
              type="button"
              onClick={open}
              aria-label="Attach files"
              className="text-muted-foreground hover:bg-accent hover:text-foreground mb-1 grid size-7 shrink-0 place-items-center rounded-lg transition-colors"
            >
              <Paperclip className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={() => onSubmit()}
              disabled={empty || busy}
              aria-label="Send"
              className={cn(
                "mb-1 grid size-7 shrink-0 place-items-center rounded-full transition",
                "disabled:cursor-not-allowed disabled:opacity-35",
                empty || busy
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              <ArrowUp className="size-3.5" />
            </button>
          </div>
        )}
      </Attachments>

      <div className="border-hairline flex flex-wrap items-center gap-1.5 border-t px-2.5 py-1.5">
        {controls}
        <span className="text-muted-foreground/60 ml-auto pr-1 text-[11px] whitespace-nowrap">
          {hint ?? "⌘↵ to send"}
        </span>
      </div>
    </div>
  )
}
