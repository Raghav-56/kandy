import { daemonToken } from "@/lib/daemon-token"
import { useEffect, useState } from "react"
import type { AgentId } from "@kandy/core"
import { KandyClient } from "@kandy/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui"

/**
 * Which model an agent runs.
 *
 * The list comes from the price table the server already fetches, filtered to
 * the provider that agent talks to. It is a menu rather than a promise — the
 * agent still refuses one you have no access to — but typing an exact model
 * string from memory is not a thing anyone should be asked to do.
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
