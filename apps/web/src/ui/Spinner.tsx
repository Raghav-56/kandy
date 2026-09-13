import { cn } from "@/lib/utils"

/**
 * Liveness as a moving line rather than a spinning circle — it sits inside a
 * row without stealing the eye, and reads as "work is moving".
 */
export function ActivityLine({ className }: { className?: string }) {
  return (
    <span className={cn("shimmer block h-px w-full text-lemon", className)} aria-hidden="true" />
  )
}
