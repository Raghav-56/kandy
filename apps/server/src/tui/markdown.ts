/**
 * An agent's reply as terminal rows: the little markdown agents actually write.
 *
 * Agents answer in markdown, and printed raw it reads as noise — `**Volume:**`,
 * backticks around every path. This renders the part that carries meaning and
 * nothing more: bold, inline code, bullets with a hanging indent, headings,
 * and fenced code. Everything else stays as written, because a half-guessed
 * italic or table is worse than the source.
 */
import type { Seg, TRow } from "./transcript.js"
import { charWidth, sanitize, textWidth } from "./text.js"

type Style = Omit<Seg, "text">

const PLAIN: Style = { tone: "plain" }

/** `**bold**` and `` `code` `` in one line, as styled pieces. Unclosed markers stay literal. */
export function inline(line: string, base: Style = PLAIN): Seg[] {
  const out: Seg[] = []
  const re = /\*\*(?=\S)(.+?)(?<=\S)\*\*|`([^`]+)`/g
  let at = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ ...base, text: line.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ ...base, text: m[1], bold: true })
    else out.push({ ...base, text: m[2]!, tone: "cyan" })
    at = m.index + m[0].length
  }
  if (at < line.length) out.push({ ...base, text: line.slice(at) })
  return out
}

/**
 * Word-wrap styled pieces to `width`, with `first` before the first row and
 * `rest` before the others — which is all a hanging indent is.
 */
function wrapSegs(segs: Seg[], width: number, first = "", rest = first): TRow[] {
  const rows: TRow[] = []
  let row: Seg[] = []
  let used = 0
  const lead = (s: string) => {
    if (s) row.push({ text: s, tone: "dim" })
    used = textWidth(s)
  }
  const flush = () => {
    // A row never ends in the space it broke at.
    const last = row[row.length - 1]
    if (last) last.text = last.text.replace(/\s+$/, "")
    rows.push(row)
    row = []
  }
  lead(first)
  const avail = () => Math.max(1, width - textWidth(rest))
  for (const seg of segs) {
    for (const word of seg.text.split(/(\s+)/)) {
      if (!word) continue
      const w = textWidth(word)
      const space = /^\s+$/.test(word)
      if (used + w > width && used > textWidth(rows.length ? rest : first)) {
        flush()
        lead(rest)
        if (space) continue
      }
      if (w > avail() && !space) {
        // Longer than a whole row: break it by cells.
        for (const ch of word) {
          const cw = charWidth(ch.codePointAt(0) ?? 0)
          if (used + cw > width) {
            flush()
            lead(rest)
          }
          push(ch)
          used += cw
        }
        continue
      }
      push(word)
      used += w
    }
    function push(text: string) {
      const prev = row[row.length - 1]
      const same =
        prev && prev.tone === seg.tone && prev.bold === seg.bold && prev.italic === seg.italic && prev.text !== first
      if (same) prev.text += text
      else row.push({ ...seg, text })
    }
  }
  flush()
  return rows
}

export function markdownRows(text: string, width: number): TRow[] {
  const w = Math.max(10, width)
  const rows: TRow[] = []
  let fenced = false
  for (const raw of sanitize(text.replace(/\r\n?/g, "\n")).split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      // Code is shown as written: never re-wrapped, cut at the edge.
      rows.push([{ text: "  " + raw, tone: "dim" }])
      continue
    }
    if (raw.trim() === "") {
      rows.push([])
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(raw)
    if (heading) {
      rows.push(...wrapSegs(inline(heading[1]!, { tone: "plain", bold: true }), w))
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(raw)
    if (bullet) {
      const pad = " ".repeat(Math.min(bullet[1]!.length, 8))
      rows.push(...wrapSegs(inline(bullet[2]!), w, `${pad}• `, `${pad}  `))
      continue
    }
    const numbered = /^(\s*)(\d+[.)])\s+(.*)$/.exec(raw)
    if (numbered) {
      const pad = " ".repeat(Math.min(numbered[1]!.length, 8))
      const mark = `${pad}${numbered[2]} `
      rows.push(...wrapSegs(inline(numbered[3]!), w, mark, " ".repeat(mark.length)))
      continue
    }
    rows.push(...wrapSegs(inline(raw), w))
  }
  return rows
}
