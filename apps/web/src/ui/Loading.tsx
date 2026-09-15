import { cn } from "@/lib/utils"

/**
 * kandy's loader: three notes being written and settling, in candy order.
 *
 * Branded rather than a generic spinner, and deliberately *not* a progress bar
 * — none of these waits have a known length, and a bar that fakes one is a lie
 * you watch. Motion stops entirely under prefers-reduced-motion, where the
 * three marks simply sit at rest.
 */
export function Loading({ size = 16, className }: { size?: number; className?: string }) {
  const tones = ["bg-berry", "bg-lemon", "bg-mint"]
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-flex items-end gap-[3px]", className)}
      style={{ height: size }}
    >
      {tones.map((tone, i) => (
        <span
          key={tone}
          className={cn("kandy-tick block rounded-[2px]", tone)}
          style={{
            width: Math.max(3, size / 5),
            height: Math.max(3, size / 5),
            animationDelay: `${i * 140}ms`,
          }}
        />
      ))}
    </span>
  )
}

/** The same loader, centred, for a whole region that has nothing in it yet. */
export function LoadingBlock({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
      <Loading size={22} />
      {label && <p className="text-muted-foreground text-aux">{label}</p>}
    </div>
  )
}

/** A grey shape standing in for a row, so a list doesn't jump when it fills. */
export function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="bg-muted mt-0.5 size-[15px] shrink-0 animate-pulse rounded-full" />
      <span className="min-w-0 flex-1 space-y-2">
        <span className="bg-muted block h-3 w-[58%] animate-pulse rounded" />
        <span className="bg-muted block h-2.5 w-[28%] animate-pulse rounded opacity-60" />
      </span>
    </div>
  )
}
