import type { AgentId, AgentInfo } from "@kandy/core"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui"
import { AgentMark, agentLabel } from "./AgentMark"

/**
 * Which agent runs this note.
 *
 * A real listbox rather than a native <select>: the OS control cannot show a
 * provider mark beside each option, and on macOS it renders in the system
 * palette — a bright, square, differently-themed thing in the middle of the
 * panel.
 */
export function AgentSelect({
  value,
  agents,
  onChange,
  className,
  label = "Agent",
}: {
  value: AgentId | null
  agents: AgentInfo[]
  onChange: (agent: AgentId) => void
  className?: string
  /** The accessible name; the visible value is the choice, not what it is. */
  label?: string
}) {
  return (
    <Select value={value ?? undefined} onValueChange={(v) => onChange(v as AgentId)}>
      <SelectTrigger size="sm" className={className} aria-label={value ? `${label}: ${agentLabel(value)}` : label}>
        <SelectValue placeholder="Choose an agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id} disabled={!a.installed}>
            <span className="flex items-center gap-2">
              <AgentMark agent={a.id} size={13} />
              {agentLabel(a.id)}
              {!a.installed && (
                <span className="text-muted-foreground text-meta">not installed</span>
              )}
              {a.installed && !a.authed && (
                <span className="text-muted-foreground text-meta">signed out</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
