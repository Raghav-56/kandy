/**
 * One accent palette, the web app's tokens (apps/web/src/styles.css, dark).
 *
 * mint   — running, success, insertions
 * lemon  — needs you: blocked, held, permission prompts
 * berry  — errors, deletions, destructive confirmations
 * cyan   — structure only (diff hunks)
 *
 * Secondary text is Ink's `dimColor`, an attribute rather than a hue, so it
 * survives NO_COLOR. With NO_COLOR every tone resolves to no colour at all and
 * hierarchy falls back to weight, dimness and inversion.
 */
export type Tone = "plain" | "dim" | "mint" | "lemon" | "berry" | "cyan"

const HEX: Record<Exclude<Tone, "plain" | "dim">, string> = {
  mint: "#74d6ac",
  lemon: "#e8c56a",
  berry: "#e87fa4",
  cyan: "#7ec8d8",
}

/** https://no-color.org: present and non-empty disables colour. */
export function colorDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env["NO_COLOR"]
  return v !== undefined && v !== ""
}

export type Palette = { color: (tone: Tone) => string | undefined; dim: (tone: Tone) => boolean }

export function palette(env: NodeJS.ProcessEnv = process.env): Palette {
  const off = colorDisabled(env)
  return {
    color: (tone) => (off || tone === "plain" || tone === "dim" ? undefined : HEX[tone]),
    dim: (tone) => tone === "dim",
  }
}

/** Ink `<Text>` props for a tone. */
export function toneProps(p: Palette, tone: Tone): { color?: string; dimColor?: boolean } {
  const color = p.color(tone)
  return {
    ...(color ? { color } : {}),
    ...(p.dim(tone) ? { dimColor: true } : {}),
  }
}
