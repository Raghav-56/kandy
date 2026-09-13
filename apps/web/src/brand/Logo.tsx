import { cn } from "@/lib/utils"

/**
 * The kandy mark: a sticky note with a folded corner, in candy stripes.
 *
 * Drawn rather than imported so it inherits colour, scales cleanly at 16px in
 * a sidebar and 64px in an empty state, and needs no asset pipeline.
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
      <defs>
        <clipPath id="kandy-note">
          <path d="M5 7a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v12.5L19.5 28H8a3 3 0 0 1-3-3z" />
        </clipPath>
      </defs>

      {/* The paper. */}
      <g clipPath="url(#kandy-note)">
        <rect x="4" y="3" width="24" height="26" fill="var(--color-paper)" />
        {/* Candy stripes — the only place kandy is loud. */}
        <rect x="4" y="3" width="24" height="5" fill="var(--color-berry)" opacity="0.9" />
        <rect x="4" y="8" width="24" height="3.5" fill="var(--color-lemon)" opacity="0.85" />
        <rect x="4" y="11.5" width="24" height="2.5" fill="var(--color-mint)" opacity="0.8" />
      </g>

      {/* The folded corner: what makes it a note and not a card. */}
      <path d="M27 19.5 19.5 28v-5.5a3 3 0 0 1 3-3z" fill="var(--color-paper-2)" />
      <path
        d="M5 7a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v12.5L19.5 28H8a3 3 0 0 1-3-3z"
        fill="none"
        stroke="rgb(0 0 0 / 0.25)"
        strokeWidth="1"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size={18} />
      <span className="text-[14.5px] font-semibold tracking-[-0.03em]">kandy</span>
    </span>
  )
}
