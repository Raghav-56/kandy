import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * The status vocabulary, as a dot and a pill.
 *
 * shadcn's Badge is tone-agnostic; kandy's statuses are not. Every state gets a
 * colour AND a word — roughly eight percent of men cannot reliably separate the
 * berry from the mint, so colour is never the only carrier.
 */
export const toneStyles = cva("", {
  variants: {
    tone: {
      neutral: "text-muted-foreground",
      berry: "text-berry",
      mint: "text-mint",
      lemon: "text-lemon",
      sky: "text-sky",
      grape: "text-grape",
    },
  },
  defaultVariants: { tone: "neutral" },
})

const DOT_BG: Record<string, string> = {
  neutral: "bg-muted-foreground/60",
  berry: "bg-berry",
  mint: "bg-mint",
  lemon: "bg-lemon",
  sky: "bg-sky",
  grape: "bg-grape",
}

const PILL_BG: Record<string, string> = {
  neutral: "bg-muted",
  berry: "bg-berry-bg",
  mint: "bg-mint-bg",
  lemon: "bg-lemon-bg",
  sky: "bg-sky-bg",
  grape: "bg-grape-bg",
}

export type Tone = NonNullable<VariantProps<typeof toneStyles>["tone"]>

export function Dot({
  tone = "neutral",
  pulse,
  className,
}: {
  tone?: Tone
  pulse?: boolean | undefined
  className?: string | undefined
}) {
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", DOT_BG[tone], pulse && "breathe", className)}
    />
  )
}

export function StatusPill({
  tone = "neutral",
  pulse,
  children,
  className,
}: {
  tone?: Tone
  pulse?: boolean | undefined
  children: React.ReactNode
  className?: string | undefined
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        PILL_BG[tone],
        toneStyles({ tone }),
        className,
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  )
}
