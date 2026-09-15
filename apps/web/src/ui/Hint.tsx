import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** A hint on hover and on focus. Wraps shadcn's Tooltip so call sites stay short. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-aux leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  )
}
