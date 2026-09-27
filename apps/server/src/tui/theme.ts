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

/**
 * Sticky-note paper, per state: a faint tint to read the board by at a glance,
 * a quiet border, and a bright one for the card the keyboard is on. Tuned for
 * dark terminals, where kandy's palette lives; with NO_COLOR a card is its
 * border alone, and the selected one is drawn double.
 */
export type PaperColors = { bg?: string; border?: string; title?: string; style: "round" | "double" | "bold" }

const PAPERS: Record<string, { bg?: string; border: string; bright: string }> = {
  draft: { bg: "#1f1e28", border: "#3b3948", bright: "#cfcadf" },
  running: { bg: "#13222d", border: "#294656", bright: "#7ec8d8" },
  needs: { bg: "#272011", border: "#574724", bright: "#e8c56a" },
  review: { bg: "#13241c", border: "#2b4d3d", bright: "#74d6ac" },
  failed: { bg: "#29141e", border: "#56293b", bright: "#e87fa4" },
  done: { border: "#2c2a38", bright: "#8a8794" },
}

export function paperColors(paper: string, selected: boolean, env: NodeJS.ProcessEnv = process.env): PaperColors {
  if (colorDisabled(env)) return { style: selected ? "double" : "round" }
  const c = PAPERS[paper] ?? PAPERS["draft"]!
  return {
    ...(c.bg ? { bg: c.bg } : {}),
    border: selected ? c.bright : c.border,
    ...(paper === "done" ? { title: "#8a8794" } : {}),
    style: "round",
  }
}
