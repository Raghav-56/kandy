/**
 * Terminal text measurement, without a dependency.
 *
 * Ink measures what it draws, but scrolling needs to know how many rows a
 * transcript will take *before* it is drawn — so wrapping happens here, on
 * plain strings, and every row handed to Ink is already one row wide.
 */

/** Cells a code point occupies: 0 for combining marks, 2 for wide CJK/fullwidth, else 1. */
export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  // Combining marks and zero-width joiners/selectors.
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x2060
  )
    return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch.codePointAt(0) ?? 0)
  return w
}

/** Tabs and control characters would desync every column count; flatten them. */
export function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\t/g, "  ").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
}

/** Cut to `width` cells, marking the cut with an ellipsis. */
export function truncate(s: string, width: number): string {
  if (width <= 0) return ""
  if (textWidth(s) <= width) return s
  let out = ""
  let w = 0
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0) ?? 0)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return out + "…"
}

/** Pad with spaces to exactly `width` cells (truncating first if needed). */
export function fit(s: string, width: number): string {
  const t = truncate(s, width)
  return t + " ".repeat(Math.max(0, width - textWidth(t)))
}

/**
 * Word-wrap one paragraph (no newlines) to `width` cells. Words longer than a
 * row are broken hard rather than overflowing.
 */
function wrapParagraph(line: string, width: number): string[] {
  if (line === "") return [""]
  const rows: string[] = []
  let cur = ""
  let curW = 0
  const words = line.split(/(\s+)/)
  for (const word of words) {
    if (word === "") continue
    const ww = textWidth(word)
    if (curW + ww <= width) {
      cur += word
      curW += ww
      continue
    }
    if (/^\s+$/.test(word)) {
      // Whitespace at a break is dropped.
      rows.push(cur)
      cur = ""
      curW = 0
      continue
    }
    if (cur !== "") {
      rows.push(cur.trimEnd())
      cur = ""
      curW = 0
    }
    if (ww <= width) {
      cur = word
      curW = ww
      continue
    }
    for (const ch of word) {
      const cw = charWidth(ch.codePointAt(0) ?? 0)
      if (curW + cw > width) {
        rows.push(cur)
        cur = ""
        curW = 0
      }
      cur += ch
      curW += cw
    }
  }
  rows.push(cur.trimEnd())
  return rows
}

/** Wrap text (which may contain newlines) into rows no wider than `width`. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width)
  return sanitize(text.replace(/\r\n?/g, "\n"))
    .split("\n")
    .flatMap((p) => wrapParagraph(p, w))
}

/** Cut from the left, keeping the end — for paths, where the end is the name. */
export function truncateStart(s: string, width: number): string {
  if (width <= 0) return ""
  if (textWidth(s) <= width) return s
  const chars = [...s]
  let out = ""
  let w = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i]!.codePointAt(0) ?? 0)
    if (w + cw > width - 1) break
    out = chars[i] + out
    w += cw
  }
  return "…" + out
}

/** `/Users/me/src/x` → `~/src/x`. */
export function tildify(path: string, home: string | undefined = process.env["HOME"]): string {
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length)
  return path
}
