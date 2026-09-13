import { cn } from "@/lib/utils"

/** Keyboard hints, so the shortcuts are discoverable rather than folklore. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-line bg-raised px-1 py-px font-sans text-[10px] font-medium text-faint",
        className,
      )}
    >
      {children}
    </kbd>
  )
}
