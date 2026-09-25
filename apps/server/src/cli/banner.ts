/**
 * The mark, in a terminal.
 *
 * The same object the web app draws (`apps/web/src/brand/Logo.tsx`): a
 * rounded rail holding three bars — one board, several agents, each in its
 * own lane — in berry, lemon and mint. Colour is dropped when the output is
 * not a TTY or NO_COLOR is set, so piping `kandy ls` somewhere never ships
 * escape codes.
 */
const COLOUR = process.stdout.isTTY && !process.env["NO_COLOR"]

/**
 * The brand's exact colours where the terminal can show them, and the
 * nearest of the 256 where it cannot. Most modern terminals announce 24-bit
 * colour in COLORTERM; the rest get a close match rather than nothing.
 */
const TRUE = /truecolor|24bit/i.test(process.env["COLORTERM"] ?? "")

const c = (code: string, s: string) => (COLOUR ? `\x1b[${code}m${s}\x1b[0m` : s)
const brand = (rgb: [number, number, number], fallback: string) => (s: string) =>
  c(TRUE ? `38;2;${rgb.join(";")}` : `38;5;${fallback}`, s)

export const dim = (s: string) => c("2;37", s)
export const bold = (s: string) => c("1", s)
// The three from the logo's favicon, so the terminal and the tab agree.
export const berry = brand([232, 127, 164], "211")
export const lemon = brand([232, 197, 106], "222")
export const mint = brand([116, 214, 172], "115")
export const sky = (s: string) => c("38;5;111", s)
export const grape = (s: string) => c("38;5;141", s)
export const faint = (s: string) => c("38;5;244", s)

/**
 * The logo, drawn as pixels: the favicon — three upright bars, berry,
 * lemon, mint, on a filled dark tile — scaled onto a 12×12 grid.
 *
 * Each character cell holds two pixels — `▀` with the top pixel as its
 * foreground and the bottom as its background — and a terminal cell is
 * about twice as tall as it is wide, so the pixels come out square and the
 * tile stays square. Bars fill columns 2–3, 5–6 and 8–9 across rows 3–8:
 * the favicon's 6-wide, 18-tall bars at the same 1:3. Corners are left out
 * to round the tile.
 *
 * The tile is a shade lighter than the favicon's near-black, standing in for
 * the favicon's faint rim: a rim drawn in cells comes out twice as thick on
 * the sides as on the top, because a cell is twice as tall as it is wide, so
 * the tile itself carries the edge instead and still reads on a dark terminal.
 */
type RGB = [number, number, number]
const TILE: RGB = [38, 36, 47]
const BERRY: RGB = [232, 127, 164]
const LEMON: RGB = [232, 197, 106]
const MINT: RGB = [116, 214, 172]

function pixel(x: number, y: number): RGB | null {
  const edge = (v: number) => v === 0 || v === 11
  if (edge(x) && edge(y)) return null // rounded corner
  if (y >= 3 && y <= 8) {
    if (x === 2 || x === 3) return BERRY
    if (x === 5 || x === 6) return LEMON
    if (x === 8 || x === 9) return MINT
  }
  return TILE
}

/** The nearest xterm-256 colour, for terminals that cannot do 24-bit. */
function x256([r, g, b]: RGB): number {
  const q = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)))
  return 16 + 36 * q(r) + 6 * q(g) + q(b)
}
const fg = (rgb: RGB) => (TRUE ? `38;2;${rgb.join(";")}` : `38;5;${x256(rgb)}`)
const bg = (rgb: RGB) => (TRUE ? `48;2;${rgb.join(";")}` : `48;5;${x256(rgb)}`)

export function logo(): string[] {
  if (!COLOUR) {
    // A filled tile cannot be drawn without colour; its outline and bars can.
    return ["╭───────╮", "│ ▄ ▄ ▄ │", "│ █ █ █ │", "│ ▀ ▀ ▀ │", "╰───────╯"]
  }
  const rows: string[] = []
  for (let y = 0; y < 12; y += 2) {
    let line = ""
    for (let x = 0; x < 12; x++) {
      const top = pixel(x, y)
      const bottom = pixel(x, y + 1)
      if (!top && !bottom) line += " "
      else if (!top) line += `\x1b[${fg(bottom!)}m▄\x1b[0m`
      else if (!bottom) line += `\x1b[${fg(top)}m▀\x1b[0m`
      else line += `\x1b[${fg(top)};${bg(bottom)}m▀\x1b[0m`
    }
    rows.push(line)
  }
  return rows
}

/** One line of it, for headers too short for the whole mark: the three bars, in order. */
export function mark(): string {
  return `${berry("▮")}${lemon("▮")}${mint("▮")}`
}

export function banner(subtitle?: string): string {
  const l = logo()
  const pad = (i: number) => l[i] ?? " ".repeat(12)
  return [
    "",
    `  ${pad(0)}`,
    `  ${pad(1)}`,
    `  ${pad(2)}  ${bold("kandy")}`,
    `  ${pad(3)}  ${faint(subtitle ?? "a board for coding agents")}`,
    `  ${pad(4)}`,
    ...(l.length > 5 ? [`  ${pad(5)}`] : []),
    "",
  ].join("\n")
}

/**
 * Five steps of intensity, in the candy palette.
 *
 * Same idea as a contribution graph: the shape of a month of work is legible at
 * a glance in a way a table of numbers never is. Empty days are drawn, not
 * skipped — a gap is information.
 */
const HEAT = ["238", "96", "132", "175", "218"]

export function heat(level: number): string {
  const code = HEAT[Math.max(0, Math.min(HEAT.length - 1, level))]!
  return c(`38;5;${code}`, "■")
}

/** A row of block characters scaled to the largest value. */
export function sparkline(values: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█"
  const max = Math.max(...values, 1)
  return values
    .map((v) => {
      if (v === 0) return dim("·")
      const i = Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))
      return lemon(blocks[i]!)
    })
    .join("")
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
