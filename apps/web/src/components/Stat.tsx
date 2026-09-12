import { cn } from "@/lib/utils"

/**
 * A labelled number. Used in rows so the eye can scan values, not sentences —
 * the point of the detail panel is that you read it without reading it.
 */
export function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string
  value: string
  tone?: "default" | "amber" | "coral" | "sage"
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">{label}</div>
      <div
        className={cn(
          "mt-1 truncate text-[15px] font-medium tabular-nums tracking-[-0.01em]",
          tone === "amber" && "text-amber",
          tone === "coral" && "text-coral",
          tone === "sage" && "text-sage",
          (!tone || tone === "default") && "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  )
}
