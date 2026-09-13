import { cn } from "@/lib/utils"

/**
 * The kandy mark: three notes assembling into a lowercase "k".
 *
 * Designed by Codex, reviewed side by side against the previous striped-note
 * mark at 16/20/24/44/72px on both themes. The note lost: at sidebar size its
 * stripes collapse into an unreadable smudge, while a letterform still reads.
 * The three pieces are the idea — independent jobs that add up to one thing.
 *
 * Changed from what it proposed: the arms were three units clear of the stem,
 * which at 16px reads as a broken glyph rather than a deliberate gap.
 */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="8" height="24" rx="2" fill="var(--color-berry)" />
      <path d="M12.5 11 20 4h8L16.5 15h-4Z" fill="var(--color-lemon)" />
      <path d="M12.5 18h4L28 28h-8l-7.5-7Z" fill="var(--color-mint)" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size={19} />
      <span className="text-[14.5px] font-semibold tracking-[-0.03em]">kandy</span>
    </span>
  )
}
