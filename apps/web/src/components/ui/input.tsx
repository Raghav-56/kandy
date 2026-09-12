import * as React from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-[13px] text-ink",
        "placeholder:text-faint focus:border-[#32323b] focus:outline-none",
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] leading-relaxed text-ink",
        "placeholder:text-faint focus:border-[#32323b] focus:outline-none",
        className,
      )}
      {...props}
    />
  )
}
