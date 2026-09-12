import * as React from "react"
import { cn } from "@/lib/utils"

/** Carbon surface, hairline border. One shade above the canvas, no more. */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[4px] border border-[#2a2a2a] bg-carbon px-3 text-[13px] text-paper-white",
        "placeholder:text-smoke focus:border-ash focus:outline-none",
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
        "w-full resize-none rounded-[4px] border border-[#2a2a2a] bg-carbon px-3 py-2 text-[13px] leading-relaxed text-paper-white",
        "placeholder:text-smoke focus:border-ash focus:outline-none",
        className,
      )}
      {...props}
    />
  )
}
