import { cn } from "@/lib/utils"

/**
 * The two marks the Usage page needs, and nothing else.
 *
 * Both are plain HTML — a bar is a div with a width, and reaching for a
 * charting library to draw one would cost more bytes than the whole page. The
 * colours come from --color-mark-*, which are the palette's hues stepped into
 * the lightness band a filled mark needs and checked with the validator in
 * both themes.
 */

/**
 * A ranked list of one measure.
 *
 * One hue, not a ramp: every bar is the same kind of thing and a colour scale
 * would imply an order beyond the length, which already says it. Labels sit on
 * the rows rather than on an axis, because the rows are the labels — this is a
 * table that can be read as a shape.
 */
export function RankedBars({
  rows,
  max,
  className,
}: {
  rows: { key: string; label: string; value: number; display: string; meta?: string }[]
  /** Shared denominator, so bars stay comparable if a caller slices the list. */
  max: number
  className?: string
}) {
  if (rows.length === 0 || max <= 0) return null

  return (
    <ul className={cn("space-y-1.5", className)}>
      {rows.map((r) => {
        const pct = Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)
        return (
          <li key={r.key} className="group/bar grid grid-cols-[1fr_auto] items-baseline gap-x-3">
            <span className="min-w-0 truncate text-[12.5px]" title={r.label}>
              {r.label}
            </span>
            <span className="text-[12px] tabular-nums">
              {r.display}
              {r.meta && (
                <span className="text-muted-foreground/60 ml-2 text-[11px]">{r.meta}</span>
              )}
            </span>
            <span className="col-span-2 mt-1 block h-1.5 w-full rounded-full bg-[var(--color-hairline)]">
              <span
                className="block h-full rounded-full bg-[var(--color-mark-solo)] transition-[width] duration-500 ease-[var(--ease-rise)]"
                style={{ width: `${pct}%` }}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * How one total divides between a few named things.
 *
 * A single bar rather than a pie: comparing lengths along one line is a job
 * people are good at, and comparing angles is one they are not. Segments carry
 * a 2px surface gap so two fills never touch and read as one, and each is named
 * in the legend *and* labelled with its share — identity is never colour alone.
 */
export function SplitBar({
  parts,
  total,
  className,
}: {
  parts: { key: string; label: string; value: number; display: string; mark: string }[]
  total: number
  className?: string
}) {
  const shown = parts.filter((p) => p.value > 0)
  if (shown.length === 0 || total <= 0) return null

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
        {shown.map((p) => (
          <span
            key={p.key}
            title={`${p.label} — ${p.display}`}
            style={{ width: `${(p.value / total) * 100}%`, background: p.mark }}
            className="block h-full first:rounded-l-full last:rounded-r-full"
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {shown.map((p) => (
          <li key={p.key} className="flex items-baseline gap-2 text-[12px]">
            <span
              aria-hidden="true"
              style={{ background: p.mark }}
              className="size-2 shrink-0 translate-y-[1px] rounded-[3px]"
            />
            <span>{p.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {p.display}
              <span className="text-muted-foreground/60 ml-1.5">
                {Math.round((p.value / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
