import * as React from "react"
import { cn } from "@/lib/utils"

const base =
  "w-full rounded-lg border border-line bg-raised text-ink placeholder:text-faint focus:border-[#3a3850] focus:outline-none"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(base, "h-9 px-3 text-[13px]", className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(base, "resize-none px-3 py-2 text-[13px] leading-relaxed", className)}
      {...props}
    />
  )
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(base, "h-7 cursor-pointer px-2 text-[12px]", className)}
      {...props}
    />
  )
}

export function Label({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("label", className)} {...props} />
}
