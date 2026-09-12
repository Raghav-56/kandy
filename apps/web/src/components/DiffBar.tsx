import type { DiffStat } from "@kandy/core"
import { cn } from "@/lib/utils"

/**
 * Diff size as a shape, not a sentence.
 *
 * Five blocks split between insertions and deletions, the way a diff is read
 * on a PR. "+105 −1" is a number you have to parse; a bar that is almost all
 * green is a fact you absorb without reading.
 */
export function DiffBar({ stat, onDark }: { stat: DiffStat; onDark?: boolean }) {
  const total = stat.insertions + stat.deletions
  if (total === 0) return null

  const blocks = 5
  const added = Math.max(
    stat.insertions > 0 ? 1 : 0,
    Math.min(blocks - (stat.deletions > 0 ? 1 : 0), Math.round((stat.insertions / total) * blocks)),
  )

  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-[2px]">
        {Array.from({ length: blocks }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-[9px] w-[9px] rounded-[2px]",
              i < added ? "bg-sage" : i < added + (stat.deletions > 0 ? blocks : 0) ? "bg-coral" : "",
              i >= added && stat.deletions === 0 && (onDark ? "bg-line" : "bg-black/10"),
              i >= added && stat.deletions > 0 && "bg-coral",
            )}
          />
        ))}
      </span>
      <span className="tabular-nums">
        <span className="text-sage">+{stat.insertions}</span>{" "}
        <span className="text-coral">−{stat.deletions}</span>
      </span>
    </span>
  )
}
