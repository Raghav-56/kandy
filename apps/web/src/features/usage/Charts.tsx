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
            <span className="min-w-0 truncate text-aux" title={r.label}>
              {r.label}
            </span>
            <span className="text-aux tabular-nums">
              {r.display}
              {r.meta && (
                <span className="text-muted-foreground/60 ml-2 text-meta">{r.meta}</span>
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
          <li key={p.key} className="flex items-baseline gap-2 text-aux">
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

/**
 * Where work goes, and where it stops.
 *
 * The one shape only kandy can draw: a note is written, run, reviewed, and
 * lands — and the interesting number is what fell out between two steps, not
 * the stages themselves. Each row is labelled with its own count and the drop
 * is called out beside it, because "21 → 20" is the fact and a shape alone
 * makes you measure it with your eye.
 */
export function Funnel({
  stages,
  className,
}: {
  stages: { key: string; label: string; value: number }[]
  className?: string
}) {
  const top = stages[0]?.value ?? 0
  if (top <= 0) return null

  return (
    <ol className={cn("space-y-2", className)}>
      {stages.map((st, i) => {
        const prev = i === 0 ? null : stages[i - 1]!.value
        const lost = prev === null ? 0 : prev - st.value
        return (
          <li key={st.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-aux">{st.label}</span>
              <span className="text-aux tabular-nums">
                {st.value}
                {lost > 0 && (
                  <span className="text-muted-foreground/70 ml-2 text-meta">−{lost}</span>
                )}
              </span>
            </div>
            <span className="mt-1 block h-2 w-full rounded-full bg-[var(--color-hairline)]">
              <span
                className="block h-full rounded-full bg-[var(--color-mark-solo)]"
                style={{ width: `${(st.value / top) * 100}%` }}
              />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Counts across an ordinal run — the hours of a day.
 *
 * Bars rather than a line: an hour is a bucket, not a point on a continuum,
 * and a line between 23:00 and 00:00 would draw a slope across a boundary
 * nothing crosses. Only the busiest hour is labelled; a number over every bar
 * is twenty-four numbers nobody reads.
 */
export function Hours({ hours, className }: { hours: number[]; className?: string }) {
  const max = Math.max(...hours, 0)
  if (max <= 0) return null
  const peak = hours.indexOf(max)

  return (
    <div className={className}>
      <div className="flex h-24 items-end gap-[3px]">
        {hours.map((n, h) => (
          <div
            key={h}
            title={`${String(h).padStart(2, "0")}:00 — ${n} run${n === 1 ? "" : "s"}`}
            className="group/h flex h-full flex-1 flex-col justify-end"
          >
            <span
              className={cn(
                "block w-full rounded-t-[3px]",
                h === peak ? "bg-[var(--color-mark-solo)]" : "bg-[var(--color-mark-solo)]/35",
              )}
              style={{ height: `${Math.max((n / max) * 100, n > 0 ? 4 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground/60 mt-1.5 flex justify-between text-micro tabular-nums">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <p className="text-muted-foreground mt-2 text-aux">
        Busiest at {String(peak).padStart(2, "0")}:00 — {max} run{max === 1 ? "" : "s"}.
      </p>
    </div>
  )
}

/**
 * Twelve weeks of days, including the empty ones.
 *
 * A gap is information: it says the board sat still, which a list of only the
 * days that had runs would hide. One hue in four steps rather than a colour
 * scale — this is magnitude, and magnitude is what a single hue getting darker
 * is for.
 */
export function Activity({
  daily,
  className,
}: {
  daily: { date: string; runs: number }[]
  className?: string
}) {
  const max = Math.max(...daily.map((d) => d.runs), 0)
  if (daily.length === 0) return null

  // Pad the front so the first column starts on the right weekday.
  const offset = new Date(daily[0]!.date + "T00:00:00").getDay()
  const cells: ({ date: string; runs: number } | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...daily,
  ]
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const step = (runs: number) => {
    if (runs === 0) return "bg-[var(--color-hairline)]"
    const q = runs / max
    if (q > 0.66) return "bg-[var(--color-mark-solo)]"
    if (q > 0.33) return "bg-[var(--color-mark-solo)]/70"
    return "bg-[var(--color-mark-solo)]/40"
  }

  return (
    <div className={className}>
      <div className="flex gap-[3px] overflow-x-auto">
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {week.map((d, i) =>
              d === null ? (
                <span key={i} className="size-[11px]" />
              ) : (
                <span
                  key={d.date}
                  title={`${d.date} — ${d.runs} run${d.runs === 1 ? "" : "s"}`}
                  className={cn("size-[11px] rounded-[3px]", step(d.runs))}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground/60 mt-2.5 flex items-center gap-1.5 text-micro">
        <span>Less</span>
        <span className="size-[9px] rounded-[2px] bg-[var(--color-hairline)]" />
        <span className="size-[9px] rounded-[2px] bg-[var(--color-mark-solo)]/40" />
        <span className="size-[9px] rounded-[2px] bg-[var(--color-mark-solo)]/70" />
        <span className="size-[9px] rounded-[2px] bg-[var(--color-mark-solo)]" />
        <span>More</span>
      </div>
    </div>
  )
}
