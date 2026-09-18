import { daemonToken } from "@/lib/daemon-token"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import type { AgentId } from "@kandy/core"
import { KandyClient } from "@kandy/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui"
import { cn } from "@/lib/utils"

/**
 * Which model an agent runs.
 *
 * The list comes from the price table the server already fetches, filtered to
 * the provider that agent talks to — except where the CLI itself knows better,
 * as Cursor's does. It is a menu rather than a promise: the agent still
 * refuses one you have no access to.
 *
 * Two shapes, chosen by length. A handful of models is a dropdown. Cursor's
 * account catalogue is **223** ids — every family crossed with low/medium/
 * high/xhigh and again with fast — and a 223-row scroll is not a picker, so
 * past a dozen it becomes a filter you type into.
 */
const DEFAULT = "__default__"

/**
 * One fetch per agent per session.
 *
 * The picker mounts every time a note is opened, and re-requesting an identical
 * list each time made the trigger flash from empty to populated on every click.
 */
const cache = new Map<string, string[]>()
const inflight = new Map<string, Promise<string[]>>()

function loadModels(agent: string): Promise<string[]> {
  const hit = cache.get(agent)
  if (hit) return Promise.resolve(hit)

  const existing = inflight.get(agent)
  if (existing) return existing

  const p = new KandyClient({ baseUrl: "/api", token: daemonToken })
    .models(agent)
    .then((r) => {
      cache.set(agent, r.models)
      return r.models
    })
    .catch(() => [] as string[])
    .finally(() => inflight.delete(agent))

  inflight.set(agent, p)
  return p
}

/** Past this many, scrolling stops being a way to find anything. */
const FILTER_ABOVE = 12

/** Roughly how tall the open panel is, for deciding which way it fits. */
const PANEL_PX = 340

/**
 * A filterable list, built plainly rather than on Radix's Select.
 *
 * Select owns the keyboard — it has its own typeahead and it moves focus to
 * the checked item when it opens — so an input living inside it spends its
 * life fighting the component around it. This is the same shape the repo
 * picker uses: a panel, a field, and a list that answers to the field.
 */
function ModelFilter({
  options,
  value,
  placeholder,
  onChange,
  className,
}: {
  options: string[]
  value: string | null
  placeholder: string
  onChange: (model: string | null) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [pick, setPick] = useState(0)
  /*
   * Which way the panel opens.
   *
   * It cannot always go up: this picker appears in the composer at the bottom
   * of the window, where up is the only option, and again in Settings halfway
   * down, where up runs the filter field off the top of the screen. So it asks
   * the trigger where it is and takes whichever side has room.
   */
  const [up, setUp] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const r = box.current?.getBoundingClientRect()
    if (r) setUp(window.innerHeight - r.bottom < PANEL_PX && r.top > PANEL_PX)
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", away)
    return () => document.removeEventListener("mousedown", away)
  }, [open])

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return options
    // Every space-separated word has to appear, so "opus fast" narrows rather
    // than widening — with 223 ids, one word is rarely enough.
    const words = needle.split(/\s+/)
    return options.filter((m) => words.every((w) => m.toLowerCase().includes(w)))
  }, [q, options])

  useEffect(() => setPick(0), [q])

  const choose = (m: string | null) => {
    onChange(m)
    setOpen(false)
    setQ("")
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "border-input flex h-7 w-full items-center gap-1.5 rounded-lg border bg-transparent py-1 pr-2 pl-2.5 text-left transition-colors",
          className,
        )}
      >
        <span
          className={cn("min-w-0 flex-1 truncate", value ? "font-mono text-aux" : "text-muted-foreground")}
        >
          {value ?? placeholder}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      </button>

      {open && (
        <div
          className={cn(
            "border-line bg-popover absolute left-0 z-50 w-[min(340px,86vw)] overflow-hidden rounded-xl border p-1.5 shadow-xl shadow-black/30",
            up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
          )}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${options.length} models`}
            className="placeholder:text-muted-foreground/60 w-full bg-transparent px-2 py-1.5 text-ui outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") return setOpen(false)
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setPick((i) => Math.min(i + 1, hits.length))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setPick((i) => Math.max(i - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                // Index 0 is the agent's own default, which is why it is not
                // simply hits[pick].
                choose(pick === 0 ? null : (hits[pick - 1] ?? null))
              }
              e.stopPropagation()
            }}
          />
          <div className="border-hairline mt-1 max-h-[280px] overflow-y-auto border-t pt-1">
            <Row on={pick === 0} chosen={value === null} onPick={() => choose(null)} muted>
              {placeholder}
            </Row>
            {hits.map((m, i) => (
              <Row
                key={m}
                on={pick === i + 1}
                chosen={value === m}
                onPick={() => choose(m)}
                onHover={() => setPick(i + 1)}
              >
                <span className="font-mono text-aux">{m}</span>
              </Row>
            ))}
            {hits.length === 0 && (
              <p className="text-muted-foreground px-2 py-1.5 text-aux">Nothing matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  on,
  chosen,
  muted,
  onPick,
  onHover,
  children,
}: {
  on: boolean
  chosen: boolean
  muted?: boolean
  onPick: () => void
  onHover?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
        on && "bg-accent",
        muted && "text-muted-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {chosen && <Check className="text-mint size-4 shrink-0" />}
    </button>
  )
}

export function ModelSelect({
  agent,
  value,
  onChange,
  placeholder = "Agent default",
  className,
}: {
  agent: AgentId | null
  value: string | null
  onChange: (model: string | null) => void
  placeholder?: string
  className?: string
}) {
  // Seed from cache so a remount paints the full list immediately.
  const [models, setModels] = useState<string[]>(() => (agent ? (cache.get(agent) ?? []) : []))

  useEffect(() => {
    if (!agent) return setModels([])
    let stale = false
    void loadModels(agent).then((m) => !stale && setModels(m))
    return () => {
      stale = true
    }
  }, [agent])

  // A model pinned before the list loaded, or one the table doesn't know, must
  // still be selectable — otherwise opening this picker silently clears it.
  const options = value && !models.includes(value) ? [value, ...models] : models

  if (options.length > FILTER_ABOVE) {
    return (
      <ModelFilter
        options={options}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        {...(className ? { className } : {})}
      />
    )
  }

  return (
    <Select
      value={value ?? DEFAULT}
      onValueChange={(v) => onChange(v === DEFAULT ? null : v)}
      disabled={!agent}
    >
      <SelectTrigger size="sm" className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        <SelectItem value={DEFAULT}>
          <span className="text-muted-foreground">{placeholder}</span>
        </SelectItem>
        {options.map((m) => (
          <SelectItem key={m} value={m}>
            <span className="font-mono text-aux">{m}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
