import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all disabled:pointer-events-none disabled:opacity-35",
  {
    variants: {
      variant: {
        solid: "bg-ink text-bg hover:bg-white",
        outline: "border border-line bg-panel-2 text-ink hover:border-[#32323b] hover:bg-[#1b1b21]",
        ghost: "text-dim hover:bg-panel-2 hover:text-ink",
        danger: "border border-[#4a2a25] bg-[#1d1312] text-coral hover:border-coral/60",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8 px-3.5 text-[12.5px]",
        lg: "h-10 px-5 text-[13.5px]",
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
