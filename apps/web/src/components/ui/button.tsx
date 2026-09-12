import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * DESIGN.md gives this system exactly two buttons: one filled pill and its
 * ghost inversion. Both are fully rounded and generously padded — a pill that
 * isn't given room reads as a chip, which is the wrong object.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[50px] font-display font-black uppercase tracking-normal transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        solid: "bg-paper-white text-obsidian hover:bg-[#d9d9d9]",
        outline: "border border-paper-white text-paper-white hover:bg-paper-white hover:text-obsidian",
        ghost: "text-ash hover:text-paper-white",
      },
      size: {
        sm: "h-7 px-4 text-[11px]",
        md: "h-9 px-6 text-[12px]",
        lg: "h-11 px-10 text-[14px]",
      },
    },
    defaultVariants: { variant: "outline", size: "sm" },
  },
)

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
