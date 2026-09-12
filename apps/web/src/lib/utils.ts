import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** Elapsed as a stopwatch, which is how a running note is actually read. */
export function duration(from: number, to: number | null): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

export function money(usd: number | null): string | null {
  if (usd === null) return null
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`
}

export function compact(n: number | null): string | null {
  if (n === null) return null
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** A path shortened from the left — the end is the part that identifies it. */
export function tailPath(p: string, max = 38): string {
  if (p.length <= max) return p
  return "…" + p.slice(p.length - max + 1)
}
