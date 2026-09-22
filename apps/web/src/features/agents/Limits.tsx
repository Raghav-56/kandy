import type { AgentLimits, LimitWindow } from "@kandy/core"
import { cn } from "@/lib/utils"

/**
 * How much of a subscription is gone, and when it comes back.
 *
 * The number a Max subscriber actually watches. Claude Code reports it inside
 * every run's stream and kandy used to throw it away; now the last reading sits
 * under the agent that reported it.
 *
 * A reading is only as fresh as the last run. The reset time is what makes an
 * old one honest: a window whose reset has passed is shown as reset, not as
 * whatever it was when last heard.
 */

const NAMES: Record<string, string> = {
  five_hour: "5h",
  seven_day: "week",
  seven_day_opus: "week · opus",
}

/** Past the reset, the window is empty again whatever the last reading said. */
function current(w: LimitWindow, now: number): number {
  return w.resetsAt !== null && w.resetsAt <= now ? 0 : w.used
}

/** Colour by consequence: fine, worth knowing, about to stop you. */
export function limitTone(used: number): "ok" | "warn" | "stop" {
  return used >= 0.95 ? "stop" : used >= 0.8 ? "warn" : "ok"
}

function resetsIn(at: number | null, now: number): string {
  if (at === null) return ""
  const mins = Math.max(0, Math.round((at - now) / 60_000))
  if (mins < 60) return `resets in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `resets in ${hours}h`
  return `resets in ${Math.round(hours / 24)}d`
}

/** The single most urgent window, for somewhere with room for one number. */
export function tightest(limits: AgentLimits | null | undefined): { label: string; used: number } | null {
  if (!limits) return null
  const now = Date.now()
  let best: { label: string; used: number } | null = null
  for (const w of limits.windows) {
    const used = current(w, now)
    if (!best || used > best.used) best = { label: NAMES[w.window] ?? w.window, used }
  }
  return best
}

export function Limits({ limits }: { limits: AgentLimits }) {
  const now = Date.now()
  const throttled = limits.status !== "allowed"
  return (
    <div className="flex flex-col gap-1.5 pt-1 pb-0.5 pl-6">
      {limits.windows.map((w) => {
        const used = current(w, now)
        const tone = throttled ? "stop" : limitTone(used)
        return (
          <div
            key={w.window}
            className="flex items-center gap-2"
            title={resetsIn(w.resetsAt, now) || undefined}
          >
            <span className="text-muted-foreground w-9 shrink-0 text-meta">{NAMES[w.window] ?? w.window}</span>
            {/* A track, because the percentage alone makes you do arithmetic
                to know how close the wall is. */}
            <span className="bg-muted relative h-1 min-w-0 flex-1 overflow-hidden rounded-full">
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "stop" ? "bg-berry" : tone === "warn" ? "bg-lemon" : "bg-mint/70",
                )}
                style={{ width: `${Math.round(used * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                "w-8 shrink-0 text-right text-meta tabular-nums",
                tone === "stop" ? "text-berry" : tone === "warn" ? "text-lemon" : "text-muted-foreground",
              )}
            >
              {Math.round(used * 100)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}
