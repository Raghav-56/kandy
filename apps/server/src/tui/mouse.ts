/**
 * The mouse, in a terminal.
 *
 * Terminals report the mouse only when asked, as escape sequences on stdin.
 * kandy asks for SGR reports (mode 1006) of presses, releases and drags
 * (1000 and 1002): `ESC [ < button ; column ; row M` for a press or motion,
 * the same ending in `m` for a release. Ink hands these to `useInput` with the
 * escape stripped — `[<0;12;5M` — and never as the Escape key, so they are
 * read there, before anything treats them as keys.
 *
 * While reporting is on, a plain drag no longer selects text: terminals give
 * that back with Shift held (Option in some macOS terminals).
 */

/** Ask for presses, releases, drags and the wheel, reported as SGR. */
export const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h"
/** Hand the mouse back. Must run on every way out, or the shell prints reports. */
export const MOUSE_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l"

export type MouseButton = "left" | "middle" | "right"

export type MouseEvent =
  | { type: "down" | "up" | "drag"; button: MouseButton; x: number; y: number; shift: boolean; alt: boolean; ctrl: boolean }
  | { type: "wheel"; dir: "up" | "down"; x: number; y: number; shift: boolean; alt: boolean; ctrl: boolean }

const SGR = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/

/** Whether `useInput`'s input is a mouse report at all — to be taken out of key handling. */
export function isMouse(input: string): boolean {
  return SGR.test(input)
}

/**
 * One report, as an event. Coordinates are 0-based: column 1 row 1 is (0, 0),
 * the top-left cell, which is what layout code counts from.
 */
export function parseMouse(input: string): MouseEvent | null {
  const m = SGR.exec(input)
  if (!m) return null
  const code = Number(m[1])
  const x = Number(m[2]) - 1
  const y = Number(m[3]) - 1
  const release = m[4] === "m"
  const mods = { shift: (code & 4) !== 0, alt: (code & 8) !== 0, ctrl: (code & 16) !== 0 }
  if (code & 64) return { type: "wheel", dir: (code & 1) === 0 ? "up" : "down", x, y, ...mods }
  const which = code & 3
  const button: MouseButton = which === 0 ? "left" : which === 1 ? "middle" : "right"
  if (code & 32) return { type: "drag", button, x, y, ...mods }
  return { type: release ? "up" : "down", button, x, y, ...mods }
}

/**
 * Double clicks, which terminals don't report: two presses of the same thing
 * close enough together. `now` is injectable so tests needn't sleep.
 */
export function clickCounter(windowMs = 400) {
  let last: { key: string; at: number; count: number } | null = null
  return (key: string, now = Date.now()): number => {
    const count = last && last.key === key && now - last.at <= windowMs ? last.count + 1 : 1
    last = { key, at: now, count }
    return count
  }
}

/** Whether to turn the mouse on at all: off with KANDY_NO_MOUSE, and never without a terminal. */
export function mouseWanted(env: NodeJS.ProcessEnv = process.env, tty = !!process.stdout.isTTY): boolean {
  const off = env["KANDY_NO_MOUSE"]
  return tty && (off === undefined || off === "" || off === "0")
}
