/**
 * A small line editor: enough for a title, a steer, a review comment.
 *
 * A reducer over (text, cursor) so it can be tested without a terminal. The
 * key shape is Ink's, trimmed to what is read here.
 */
export type KeyLike = {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
  return?: boolean
  escape?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  tab?: boolean
  backspace?: boolean
  delete?: boolean
}

export type Editor = { text: string; cursor: number }

export const emptyEditor = (text = ""): Editor => ({ text, cursor: text.length })

export type EditResult = { editor: Editor; done: "submit" | "cancel" | null }

function insert(ed: Editor, s: string): Editor {
  return { text: ed.text.slice(0, ed.cursor) + s + ed.text.slice(ed.cursor), cursor: ed.cursor + s.length }
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1
}

function lineEnd(text: string, at: number): number {
  const i = text.indexOf("\n", at)
  return i === -1 ? text.length : i
}

export function editKey(ed: Editor, input: string, key: KeyLike, opts: { multiline?: boolean } = {}): EditResult {
  const same = (editor: Editor): EditResult => ({ editor, done: null })
  const multiline = opts.multiline ?? false

  if (key.escape) return { editor: ed, done: "cancel" }
  // ctrl+j arrives as a bare "\n"; alt+enter as a return with meta.
  const newline = (key.return && key.meta) || input === "\n"
  if (newline) return same(multiline ? insert(ed, "\n") : ed)
  if (key.return) return { editor: ed, done: "submit" }

  if (key.backspace) {
    if (key.meta || (key.ctrl && input === "w")) return same(deleteWord(ed))
    if (ed.cursor === 0) return same(ed)
    return same({ text: ed.text.slice(0, ed.cursor - 1) + ed.text.slice(ed.cursor), cursor: ed.cursor - 1 })
  }
  if (key.delete) {
    if (ed.cursor >= ed.text.length) return same(ed)
    return same({ text: ed.text.slice(0, ed.cursor) + ed.text.slice(ed.cursor + 1), cursor: ed.cursor })
  }
  if (key.leftArrow) return same({ ...ed, cursor: Math.max(0, ed.cursor - 1) })
  if (key.rightArrow) return same({ ...ed, cursor: Math.min(ed.text.length, ed.cursor + 1) })
  if (key.home) return same({ ...ed, cursor: lineStart(ed.text, ed.cursor) })
  if (key.end) return same({ ...ed, cursor: lineEnd(ed.text, ed.cursor) })

  if (key.ctrl) {
    switch (input) {
      case "a":
        return same({ ...ed, cursor: lineStart(ed.text, ed.cursor) })
      case "e":
        return same({ ...ed, cursor: lineEnd(ed.text, ed.cursor) })
      case "u": {
        const start = lineStart(ed.text, ed.cursor)
        return same({ text: ed.text.slice(0, start) + ed.text.slice(ed.cursor), cursor: start })
      }
      case "k":
        return same({ text: ed.text.slice(0, ed.cursor) + ed.text.slice(lineEnd(ed.text, ed.cursor)), cursor: ed.cursor })
      case "w":
        return same(deleteWord(ed))
      default:
        return same(ed)
    }
  }
  if (key.meta || key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return same(ed)
  if (!input) return same(ed)

  // Typed characters, or a whole paste in one go.
  let text = input.replace(/\r\n?/g, "\n")
  if (!multiline) text = text.replace(/\n+/g, " ")
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\t/g, "  ")
  return same(text ? insert(ed, text) : ed)
}

function deleteWord(ed: Editor): Editor {
  const before = ed.text.slice(0, ed.cursor)
  const cut = before.replace(/\S+\s*$|\s+$/, "")
  return { text: cut + ed.text.slice(ed.cursor), cursor: cut.length }
}
