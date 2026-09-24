/**
 * A unified diff as styled rows, with the row index of every file header so
 * `]` and `[` can jump between files.
 */
import type { Tone } from "./theme.js"
import { sanitize } from "./text.js"

export type DiffRow = { text: string; tone: Tone; bold: boolean }
export type ParsedDiff = { rows: DiffRow[]; files: number[] }

export function parseDiff(diff: string): ParsedDiff {
  const rows: DiffRow[] = []
  const files: number[] = []
  const lines = diff.replace(/\r\n?/g, "\n").split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  let inHeader = false
  for (const raw of lines) {
    const line = sanitize(raw)
    if (line.startsWith("diff --git ")) {
      if (rows.length > 0) rows.push({ text: "", tone: "plain", bold: false })
      files.push(rows.length)
      inHeader = true
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      rows.push({ text: m ? (m[1] === m[2] ? m[2]! : `${m[1]} → ${m[2]}`) : line, tone: "plain", bold: true })
      continue
    }
    if (inHeader) {
      if (line.startsWith("@@")) inHeader = false
      else {
        // index/mode/---/+++ lines: structure, not content.
        if (line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("rename") || line.startsWith("Binary"))
          rows.push({ text: line, tone: "dim", bold: false })
        continue
      }
    }
    if (line.startsWith("@@")) rows.push({ text: line, tone: "cyan", bold: false })
    else if (line.startsWith("+")) rows.push({ text: line, tone: "mint", bold: false })
    else if (line.startsWith("-")) rows.push({ text: line, tone: "berry", bold: false })
    else if (line.startsWith("\\")) rows.push({ text: line, tone: "dim", bold: false })
    else rows.push({ text: line, tone: "plain", bold: false })
  }
  return { rows, files }
}

/** The next (dir 1) or previous (dir -1) file header relative to `offset`. */
export function jumpFile(files: readonly number[], offset: number, dir: 1 | -1): number {
  if (files.length === 0) return offset
  if (dir === 1) return files.find((i) => i > offset) ?? offset
  const before = files.filter((i) => i < offset)
  return before[before.length - 1] ?? 0
}

export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, total - height)))
}
