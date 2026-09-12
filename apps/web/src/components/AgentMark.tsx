import type * as React from "react"
import type { AgentId } from "@kandy/core"
import { cn } from "@/lib/utils"

/**
 * Provider marks, redrawn as inline SVG.
 *
 * An agent is the closest thing a note has to an author, and a mark is read
 * faster than a word — which matters most on a board where a dozen cards are
 * competing for one glance. These are our own simplified renderings used to
 * identify which tool is running, not brand assets.
 */

type MarkProps = { className?: string; style?: React.CSSProperties }

function Claude({ className, style }: MarkProps) {
  // Anthropic's burst: tapered rays radiating from a common centre.
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2
    const inner = 1.4
    const outer = i % 2 === 0 ? 9.2 : 7.4
    const w = 1.35
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    // Perpendicular, so each ray narrows toward the centre.
    const px = -ny
    const py = nx
    return [
      `M ${12 + nx * inner + px * 0.5} ${12 + ny * inner + py * 0.5}`,
      `L ${12 + nx * outer + px * w * 0.5} ${12 + ny * outer + py * w * 0.5}`,
      `L ${12 + nx * outer - px * w * 0.5} ${12 + ny * outer - py * w * 0.5}`,
      `L ${12 + nx * inner - px * 0.5} ${12 + ny * inner - py * 0.5}`,
      "Z",
    ].join(" ")
  })
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      {rays.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

function OpenAI({ className, style }: MarkProps) {
  // The knot, as three interlocking loops. Drawn this way rather than as
  // radiating wedges so it stays clearly distinct from Claude's burst at 13px
  // — two marks that read the same are worse than no marks at all.
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        <ellipse cx="12" cy="12" rx="8.4" ry="4.1" />
        <ellipse cx="12" cy="12" rx="8.4" ry="4.1" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="8.4" ry="4.1" transform="rotate(120 12 12)" />
      </g>
    </svg>
  )
}

function Sparkle({ className, style }: MarkProps) {
  // Gemini's four-pointed star.
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path
        d="M12 2c.6 4.9 4.5 8.8 9.4 9.4v1.2C16.5 13.2 12.6 17.1 12 22h-1.2C10.2 17.1 6.3 13.2 1.4 12.6v-1.2C6.3 10.8 10.2 6.9 10.8 2z"
        fill="currentColor"
      />
    </svg>
  )
}

function Caret({ className, style }: MarkProps) {
  // Cursor's mark: a pointer rendered as a folded plane.
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path d="M4 2.5 20 12 4 21.5z" fill="currentColor" opacity="0.85" />
      <path d="M4 2.5 20 12 4 12z" fill="currentColor" />
    </svg>
  )
}

function Slash({ className, style }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path d="M6 21 18 3h3L9 21z" fill="currentColor" />
      <path d="M3 21 15 3h3L6 21z" fill="currentColor" opacity="0.45" />
    </svg>
  )
}

/**
 * Only the marks with a brand colour that reads on both a dark desk and a
 * paper card get a fixed tint. The monochrome ones inherit `currentColor`,
 * because a near-white mark on a paper note is an invisible mark — which is
 * exactly what happened the first time.
 */
const MARKS: Record<AgentId, { Icon: typeof Claude; tint: string | null; label: string }> = {
  claude: { Icon: Claude, tint: "text-[#d97757]", label: "Claude Code" },
  codex: { Icon: OpenAI, tint: null, label: "Codex" },
  cursor: { Icon: Caret, tint: null, label: "Cursor" },
  opencode: { Icon: Slash, tint: null, label: "opencode" },
  gemini: { Icon: Sparkle, tint: "text-[#7b9ae0]", label: "Gemini" },
  grok: { Icon: Slash, tint: null, label: "Grok" },
}

export function agentLabel(agent: AgentId): string {
  return MARKS[agent]?.label ?? agent
}

export function AgentMark({
  agent,
  size = 14,
  className,
  tinted = true,
}: {
  agent: AgentId
  size?: number
  className?: string
  tinted?: boolean
}) {
  const mark = MARKS[agent]
  if (!mark) return null
  const { Icon, tint } = mark
  return (
    <Icon
      className={cn("shrink-0", tinted && tint, className)}
      style={{ width: size, height: size }}
    />
  )
}

/** The mark in a chip, for when it needs to sit on paper rather than on the desk. */
export function AgentChip({ agent, onDark }: { agent: AgentId; onDark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2 text-[11px] font-medium",
        onDark ? "bg-panel-2 text-dim" : "bg-black/[0.06] text-[#57534a]",
      )}
    >
      <AgentMark agent={agent} size={13} />
      {agentLabel(agent)}
    </span>
  )
}
