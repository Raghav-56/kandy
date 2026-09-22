import { daemonToken } from "@/lib/daemon-token"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import type { AgentId, Effort, Family, Variant } from "@kandy/core"
import { describeFamilies, parseVariant, resolveVariant } from "@kandy/core"
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
  agent,
  options,
  value,
  placeholder,
  onChange,
  onAdded,
  className,
}: {
  agent: AgentId
  options: string[]
  value: string | null
  placeholder: string
  onChange: (model: string | null) => void
  onAdded: (models: string[]) => void
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

  /*
   * Models, not ids.
   *
   * Cursor's catalogue is 224 ids and 50 models: `claude-opus-5` and its
   * nineteen effort/thinking/fast spellings are one model with knobs on it.
   * The list offers the model; the knobs sit above it, which is how everyone
   * else models this — t3code hands a model `optionDescriptors` and renders a
   * control per descriptor rather than spelling the settings into the name.
   */
  const families = useMemo(() => describeFamilies(options), [options])
  const current: Variant | null = value ? parseVariant(value) : null
  const family = current ? families.find((f) => f.family === current.family) : undefined

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return families
    // Every space-separated word has to appear, so "opus fast" narrows rather
    // than widening — over fifty models, one word is rarely enough.
    const words = needle.split(/\s+/)
    return families.filter((f) => words.every((w) => f.family.toLowerCase().includes(w)))
  }, [q, families])

  /** Turning a knob keeps the model; the id is recomposed around it. */
  const turn = (knob: Partial<Variant>) => {
    if (!family || !current) return
    onChange(resolveVariant(family, { ...current, ...knob }))
  }

  useEffect(() => setPick(0), [q])

  // Only offer to keep something that could be an id — a half-typed word is a
  // search that has not finished, not a model nobody has heard of.
  const looksLikeId = /^[\w.:\/-]{3,}$/.test(q.trim())
  const custom = useMemo(() => options.filter((m) => !m.includes(" ")), [options])

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
            /*
             * The same entrance as the Radix Select beside it, which this is
             * standing in for — it appeared instantly while every other picker
             * faded and scaled, and a control that behaves unlike its siblings
             * reads as broken rather than fast. Scaled from the edge nearest
             * the trigger, so it grows out of the button rather than the
             * middle of the air. Opened with the mouse, a handful of times a
             * day: the budget allows it. The `@` picker in the composer is
             * deliberately not given this — it opens on a keystroke, constantly.
             */
            "animate-in fade-in-0 zoom-in-[0.97] duration-150 ease-out",
            up
              ? "bottom-[calc(100%+6px)] origin-bottom-left slide-in-from-bottom-1"
              : "top-[calc(100%+6px)] origin-top-left slide-in-from-top-1",
          )}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${families.length} models`}
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
                const f = hits[pick - 1]
                choose(pick === 0 || !f ? null : resolveVariant(f, current ?? {}))
              }
              e.stopPropagation()
            }}
          />
          {family && (family.efforts.length > 0 || family.thinking || family.fast) && (
            <div className="border-hairline mt-1 flex flex-wrap items-center gap-1 border-t px-1 pt-2 pb-1">
              {family.efforts.length > 0 && (
                <>
                  <span className="label pr-0.5">Reasoning</span>
                  {family.efforts.map((e: Effort) => (
                    <Knob key={e} on={current?.effort === e} onPick={() => turn({ effort: e })}>
                      {e}
                    </Knob>
                  ))}
                  {/* Nothing selected is the model's own default, which is a
                      real choice and not the absence of one. */}
                  <Knob on={!current?.effort} onPick={() => turn({ effort: null })}>
                    default
                  </Knob>
                </>
              )}
              {family.thinking && (
                <Knob on={current?.thinking === true} onPick={() => turn({ thinking: !current?.thinking })}>
                  thinking
                </Knob>
              )}
              {family.fast && (
                <Knob on={current?.fast === true} onPick={() => turn({ fast: !current?.fast })}>
                  fast
                </Knob>
              )}
            </div>
          )}

          <div className="border-hairline mt-1 max-h-[240px] overflow-y-auto border-t pt-1">
            <Row on={pick === 0} chosen={value === null} onPick={() => choose(null)} muted>
              {placeholder}
            </Row>
            {hits.map((f: Family, i: number) => (
              <Row
                key={f.family}
                on={pick === i + 1}
                chosen={current?.family === f.family}
                // Keep the knobs you already set where the new model has them.
                onPick={() => choose(resolveVariant(f, current ?? {}))}
                onHover={() => setPick(i + 1)}
              >
                <span className="font-mono text-aux">{f.family}</span>
              </Row>
            ))}
            {hits.length === 0 &&
              (looksLikeId ? (
                /*
                 * The escape hatch, offered exactly where you discover you need
                 * it. A model shipped this morning is not in any CLI's list and
                 * certainly not in ours; typing it here keeps it.
                 */
                <Row
                  on
                  chosen={false}
                  onPick={() => {
                    const id = q.trim()
                    void new KandyClient({ baseUrl: "/api", token: daemonToken })
                      .setCustomModels(agent, [...custom, id])
                      .then(() => {
                        cache.delete(agent)
                        onAdded([...options, id])
                        choose(id)
                      })
                  }}
                >
                  Use <span className="font-mono text-aux">{q.trim()}</span> anyway
                </Row>
              ) : (
                <p className="text-muted-foreground px-2 py-1.5 text-aux">Nothing matches.</p>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Knob({
  on,
  onPick,
  children,
}: {
  on: boolean
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "rounded-md px-1.5 py-0.5 text-meta transition-colors",
        on ? "bg-grape/15 text-grape" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
        agent={agent!}
        options={options}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onAdded={setModels}
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
