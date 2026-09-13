import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** An empty state that offers the next action rather than reporting absence. */
export function Empty({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-[38ch] text-[12.5px] leading-relaxed text-dim">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
