/**
 * The mark, in a terminal.
 *
 * A sticky note with a folded corner, in candy stripes — the same object the
 * web app draws. Colour is dropped when the output is not a TTY or NO_COLOR is
 * set, so piping `kandy ls` somewhere never ships escape codes.
 */
const COLOUR = process.stdout.isTTY && !process.env["NO_COLOR"]

const c = (code: string, s: string) => (COLOUR ? `\x1b[${code}m${s}\x1b[0m` : s)

export const dim = (s: string) => c("2;37", s)
export const bold = (s: string) => c("1", s)
export const berry = (s: string) => c("38;5;211", s)
export const lemon = (s: string) => c("38;5;222", s)
export const mint = (s: string) => c("38;5;115", s)
export const sky = (s: string) => c("38;5;111", s)
export const grape = (s: string) => c("38;5;141", s)
export const faint = (s: string) => c("38;5;244", s)

export function banner(subtitle?: string): string {
  // A note with a folded bottom-right corner. Every row is six cells wide so
  // the block stays square in any monospace font.
  const note = [
    berry("▛▀▀▀▀▜"),
    lemon("▌    ▐"),
    mint("▌    ▐"),
    faint("▙▄▄▄▟▘"),
  ]
  return [
    "",
    `  ${note[0]}  ${bold("kandy")}`,
    `  ${note[1]}  ${faint(subtitle ?? "a board for orchestrating coding agents")}`,
    `  ${note[2]}`,
    `  ${note[3]}`,
    "",
  ].join("\n")
}

/** Status dot + word, matching the web app's language. */
export function statusTag(status: string): string {
  switch (status) {
    case "blocked":
      return berry("● needs you")
    case "failed":
      return berry("● failed")
    case "review":
      return mint("● review")
    case "running":
      return lemon("● running")
    case "queued":
      return sky("● queued")
    case "done":
      return faint("● done")
    default:
      return dim("○ draft")
  }
}
