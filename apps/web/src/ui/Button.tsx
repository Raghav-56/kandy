import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const button = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35",
  {
    variants: {
      tone: {
        primary: "bg-ink text-bg hover:bg-white",
        soft: "border border-line bg-raised text-ink hover:border-[#3a3850] hover:bg-[#292736]",
        ghost: "text-dim hover:bg-raised hover:text-ink",
        mint: "border border-[#2f5546] bg-[#16241e] text-mint hover:border-mint/60",
        berry: "border border-[#5a2f40] bg-[#241419] text-berry hover:border-berry/60",
      },
      size: {
        xs: "h-6 px-2 text-[11.5px]",
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8 px-3.5 text-[12.5px]",
        lg: "h-10 px-5 text-[13.5px]",
        icon: "h-7 w-7 text-[13px]",
      },
    },
    defaultVariants: { tone: "soft", size: "sm" },
  },
)

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof button> & { asChild?: boolean }

export function Button({ className, tone, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(button({ tone, size }), className)} {...props} />
}
