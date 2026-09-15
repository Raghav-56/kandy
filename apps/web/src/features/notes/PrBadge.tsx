import type { PullRequest } from "@kandy/core"
import { cn } from "@/lib/utils"

/**
 * A PR, compressed to something readable at a glance.
 *
 * Three facts matter from across a board: is it open, did CI pass, and has a
 * human approved it. Everything else is one click away on the forge.
 */
export function PrBadge({
  pr,
  onDark,
  size = "sm",
}: {
  pr: PullRequest
  onDark?: boolean
  size?: "sm" | "md"
}) {
  const tone =
    pr.state === "merged"
      ? "text-[#b18ce8]"
      : pr.state === "closed"
        ? "text-faint"
        : pr.draft
          ? "text-dim"
          : "text-mint"

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${pr.title} — ${pr.state}${pr.draft ? " (draft)" : ""}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md transition-colors",
        // min-h rather than more padding: this is a link people click, and 21px
        // was below any comfortable target without looking small enough to excuse it.
        size === "md" ? "min-h-6 px-2 py-1 text-aux" : "min-h-6 px-2 py-0.5 text-meta",
        onDark ? "bg-raised hover:bg-[#1e1e25]" : "bg-black/[0.06] hover:bg-black/[0.1]",
        tone,
      )}
    >
      <PrIcon state={pr.state} draft={pr.draft} />
      <span className="tabular-nums">#{pr.number}</span>
      {pr.checks && <Checks checks={pr.checks} />}
      {pr.review === "approved" && <span title="Approved">✓</span>}
      {pr.review === "changes_requested" && <span title="Changes requested">±</span>}
    </a>
  )
}

function PrIcon({ state, draft }: { state: PullRequest["state"]; draft: boolean }) {
  // GitHub's own shape language: a branch line with a node.
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" className="shrink-0">
      <circle cx="4" cy="4" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4" cy="12" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 6v4" stroke="currentColor" strokeWidth="1.5" />
      {state === "merged" ? (
        <path d="M6 12h3a3 3 0 0 0 3-3V6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <>
          <circle cx="12" cy="4" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M12 6v4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray={draft ? "2 2" : undefined}
          />
        </>
      )}
    </svg>
  )
}

function Checks({ checks }: { checks: NonNullable<PullRequest["checks"]> }) {
  return (
    <span
      title={`Checks ${checks}`}
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        checks === "passing" && "bg-mint",
        checks === "failing" && "bg-berry",
        checks === "pending" && "breathe bg-lemon",
      )}
    />
  )
}
