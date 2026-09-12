/**
 * Fractional indexing over a base-62 alphabet.
 *
 * Moving a note is a single write computing a key strictly between its two
 * neighbours — no renumbering the column, no write amplification, and two
 * clients dragging at once produce different keys rather than clobbering
 * each other. Also the representation a list-CRDT would want later, so
 * choosing it now keeps the door to multiplayer open for free.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const FIRST = DIGITS[0]!
const LAST = DIGITS[DIGITS.length - 1]!

/** Midpoint of `a` and `b`; either may be null meaning "open end". */
export function between(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`positions out of order: ${a} >= ${b}`)
  }

  let prefix = ""
  let i = 0
  // Consume the shared prefix; beyond the end of a string, treat it as its
  // extreme (a is all-lowest, b is all-highest).
  for (;;) {
    const ca = a?.[i] ?? FIRST
    const cb = b?.[i] ?? LAST
    if (ca !== cb) break
    prefix += ca
    i++
  }

  const lo = DIGITS.indexOf(a?.[i] ?? FIRST)
  const hi = DIGITS.indexOf(b?.[i] ?? LAST)

  if (hi - lo > 1) return prefix + DIGITS[Math.floor((lo + hi) / 2)]!

  // Adjacent digits: keep `a`'s digit and recurse into the remainder, which is
  // now bounded only above.
  return prefix + DIGITS[lo]! + between(a !== null ? a.slice(i + 1) : null, null)
}

/** n evenly-ordered positions, for seeding a fresh column. */
export function sequence(n: number): string[] {
  const out: string[] = []
  let prev: string | null = null
  for (let i = 0; i < n; i++) {
    prev = between(prev, null)
    out.push(prev)
  }
  return out
}
