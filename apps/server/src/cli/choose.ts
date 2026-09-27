import { emitKeypressEvents } from "node:readline"
import { bold, dim, faint, lemon } from "./banner.js"

/**
 * A question with a few answers, picked with the arrow keys.
 *
 * ↑ ↓ (or k j) move, Enter picks, and a number picks that answer at once —
 * so "type 2" still works for anyone who reads the list that way. Without a
 * terminal to read keys from (piped, scripted) nothing is drawn and the
 * default is the answer, which is what pressing Enter would have given.
 */
export type Choice = { label: string; hint?: string }

type Key = { name?: string; ctrl?: boolean }

/** What one key press does to the highlighted answer: move, pick, or nothing. */
export function step(
  at: number,
  count: number,
  str: string | undefined,
  key: Key,
): { at: number; done: boolean; quit?: boolean } {
  if (key.ctrl && key.name === "c") return { at, done: true, quit: true }
  if (key.name === "up" || key.name === "k") return { at: (at - 1 + count) % count, done: false }
  if (key.name === "down" || key.name === "j" || key.name === "tab") return { at: (at + 1) % count, done: false }
  if (key.name === "return" || key.name === "enter") return { at, done: true }
  const n = str && /^[1-9]$/.test(str) ? Number(str) : 0
  if (n >= 1 && n <= count) return { at: n - 1, done: true }
  return { at, done: false }
}

function line(c: Choice, i: number, selected: boolean): string {
  const mark = selected ? lemon("›") : " "
  const text = selected ? bold(c.label) : dim(c.label)
  return `\x1b[2K    ${mark} ${faint(String(i + 1))}  ${text}${c.hint ? `  ${faint(c.hint)}` : ""}\n`
}

export async function choose(choices: readonly Choice[], initial = 0): Promise<number> {
  const input = process.stdin
  const output = process.stdout
  if (!input.isTTY || !output.isTTY) return initial

  let at = initial
  const draw = (again: boolean) => {
    if (again) output.write(`\x1b[${choices.length}A`)
    choices.forEach((c, i) => output.write(line(c, i, i === at)))
  }

  emitKeypressEvents(input)
  const wasRaw = input.isRaw
  input.setRawMode(true)
  input.resume()
  output.write("\x1b[?25l") // the cursor would only blink beside the list
  draw(false)
  output.write(faint("    ↑↓ to move · enter to pick\n"))

  return new Promise((resolve) => {
    const onKey = (str: string | undefined, key: Key = {}) => {
      const next = step(at, choices.length, str, key)
      if (next.quit) {
        finish()
        output.write("\n")
        process.exit(130)
      }
      if (next.at !== at) {
        at = next.at
        output.write("\x1b[1A") // above the hint line
        draw(true)
        output.write("\x1b[1B")
      }
      if (next.done) {
        finish()
        resolve(at)
      }
    }
    const finish = () => {
      input.off("keypress", onKey)
      input.setRawMode(wasRaw)
      input.pause()
      output.write("\x1b[?25h")
    }
    input.on("keypress", onKey)
  })
}
