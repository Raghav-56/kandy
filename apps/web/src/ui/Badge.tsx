import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/** A pill with a dot. The dot is never the only signal — the word is there too. */
const badge = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-raised text-dim",
        berry: "bg-[#2a161f] text-berry",
        mint: "bg-[#15241d] text-mint",
        lemon: "bg-[#262013] text-lemon",
        sky: "bg-[#152232] text-sky",
        grape: "bg-[#1e1a32] text-grape",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-1 text-[11.5px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
)

const DOT: Record<string, string> = {
  neutral: "bg-faint",
  berry: "bg-berry",
  mint: "bg-mint",
  lemon: "bg-lemon",
  sky: "bg-sky",
  grape: "bg-grape",
}

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badge> & { dot?: boolean; pulse?: boolean }

export function Badge({ className, tone, size, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, size }), className)} {...props}>
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone ?? "neutral"], pulse && "breathe")}
        />
      )}
      {children}
    </span>
  )
}
