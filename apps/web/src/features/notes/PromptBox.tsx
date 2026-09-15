import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, FileText, Folder, Paperclip } from "lucide-react"
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
  paths,
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
  /** Repo paths offered after an `@`. Empty means the affordance is off. */
  paths?: { files: string[]; dirs: string[] }
  className?: string
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const empty = !value.trim() && files.length === 0

  /*
   * `@` opens a path picker.
   *
   * The query is whatever follows the last `@` that still has no whitespace
   * after it, so it closes itself the moment you type a space — which is what
   * a token boundary means here, and avoids needing an explicit dismiss.
   */
  const [cursor, setCursor] = useState(0)

  const entries = useMemo(
    () => [
      ...(paths?.dirs ?? []).map((path) => ({ path, dir: true })),
      ...(paths?.files ?? []).map((path) => ({ path, dir: false })),
    ],
    [paths],
  )

  const mention = useMemo(() => {
    if (entries.length === 0) return null
    const upto = value.slice(0, cursor)
    const at = upto.lastIndexOf("@")
    if (at === -1) return null
    const q = upto.slice(at + 1)
    if (/\s/.test(q)) return null
    // Only after a boundary, so an email address never opens a file picker.
    const before = at === 0 ? "" : upto[at - 1]!
    if (before && !/\s/.test(before)) return null
    return { at, q }
  }, [value, cursor, entries.length])

  const hits = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    return entries
      .filter((e) => e.path.toLowerCase().includes(q))
      .sort((a, b) => {
        /*
         * Tool and editor config last.
         *
         * `.claude/` and `.agents/` are tracked files and genuinely in the
         * repo, so hiding them would make them unreachable — but nobody points
         * an agent at them, and unranked they crowded out the source. Typing
         * the dot still surfaces them immediately.
         */
        const ad = a.path.startsWith(".") ? 1 : 0
        const bd = b.path.startsWith(".") ? 1 : 0
        if (ad !== bd) return ad - bd

        // A match on the name itself beats one buried in a parent directory.
        const an = a.path.slice(a.path.lastIndexOf("/") + 1).toLowerCase().startsWith(q) ? 0 : 1
        const bn = b.path.slice(b.path.lastIndexOf("/") + 1).toLowerCase().startsWith(q) ? 0 : 1
        if (an !== bn) return an - bn

        // Then folders: naming one names everything under it.
        if (a.dir !== b.dir) return a.dir ? -1 : 1
        return a.path.length - b.path.length
      })
      .slice(0, 8)
  }, [mention, entries])

  const [pick, setPick] = useState(0)
  useEffect(() => setPick(0), [mention?.q])

  const insert = (hit: { path: string; dir: boolean }) => {
    if (!mention) return
    // A trailing slash says "everything in here", so the agent does not have to
    // guess which of the two you meant.
    const path = hit.dir ? `${hit.path}/` : hit.path
    const next = value.slice(0, mention.at) + "@" + path + " " + value.slice(cursor)
    onChange(next)
    queueMicrotask(() => {
      const el = box.current
      if (!el) return
      const at = mention.at + path.length + 2
      el.focus()
      el.setSelectionRange(at, at)
      setCursor(at)
    })
  }

  /*
   * Grow with the text, up to a point.
   *
   * A fixed two-row box means writing anything real happens through a viewport
   * the size of a tweet.
   */
  const fit = useCallback(() => {
    const el = box.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)

    /*
     * Collapse to zero before measuring, not to `auto`.
     *
     * This is a flex child, and `auto` inside a flex container reports the
     * height the container gave it rather than the height its content needs —
     * so an empty box measured as full, pinned itself to the twelve-row
     * maximum, and squeezed the stream above it to nothing.
     */
    el.style.height = "0px"
    const content = el.scrollHeight
    el.style.height = `${Math.min(Math.max(content, line * rows + pad), line * maxRows + pad)}px`
  }, [rows, maxRows])

  useLayoutEffect(fit, [value, fit])

  /*
   * And once more after the first frame.
   *
   * On mount the measurement runs before the surrounding flex layout and the
   * web font have settled, and comes out at the maximum. One re-measure on the
   * next frame is enough; after that every keystroke re-runs it anyway.
   */
  useLayoutEffect(() => {
    const id = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(id)
  }, [fit])

  return (
    <div
      className={cn(
        "border-line bg-surface relative rounded-2xl border shadow-lg shadow-black/5",
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
              onChange={(e) => {
                // Track the caret here as well as on keyup: a paste moves it
                // without a keystroke, and the picker reads from it.
                setCursor(e.target.selectionStart)
                onChange(e.target.value)
              }}
              onPaste={onPaste}
              placeholder={placeholder}
              className="placeholder:text-muted-foreground/45 min-h-0 w-full flex-1 resize-none self-end overflow-y-auto bg-transparent py-1.5 text-title leading-[1.55] outline-none"
              onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
              onClick={(e) => setCursor(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                // While the picker is open it owns the arrows and Enter —
                // otherwise Enter would send a half-typed path.
                if (hits.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setPick((i) => (i + 1) % hits.length)
                    return
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setPick((i) => (i - 1 + hits.length) % hits.length)
                    return
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault()
                    insert(hits[pick]!)
                    return
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setCursor(-1)
                    return
                  }
                }
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

      {hits.length > 0 && (
        <div className="border-line bg-surface absolute bottom-[calc(100%+6px)] left-0 z-30 w-full overflow-hidden rounded-2xl border p-1.5 shadow-xl shadow-black/20">
          <p className="label px-2 py-1.5">In this repo</p>
          {hits.map((hit, i) => {
            const name = hit.path.slice(hit.path.lastIndexOf("/") + 1)
            const parent = hit.path.includes("/") ? hit.path.slice(0, hit.path.lastIndexOf("/")) : ""
            return (
              <button
                key={hit.path}
                type="button"
                // mousedown, not click: click fires after blur, by which point
                // the textarea has lost the selection this inserts against.
                onMouseDown={(e) => {
                  e.preventDefault()
                  insert(hit)
                }}
                onMouseEnter={() => setPick(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  i === pick ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {hit.dir ? (
                  <Folder className="text-muted-foreground/70 size-3 shrink-0" />
                ) : (
                  <FileText className="text-muted-foreground/50 size-3 shrink-0" />
                )}
                <span className="truncate font-mono text-aux">
                  {name}
                  {hit.dir && <span className="text-muted-foreground/60">/</span>}
                </span>
                <span className="text-muted-foreground/60 min-w-0 flex-1 truncate text-right font-mono text-micro">
                  {parent}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="border-hairline flex flex-wrap items-center gap-1.5 border-t px-2.5 py-1.5">
        {controls}
        <span className="text-muted-foreground/60 ml-auto pr-1 text-meta whitespace-nowrap">
          {hint ?? "⌘↵ to send"}
        </span>
      </div>
    </div>
  )
}
