import test from "node:test"
import assert from "node:assert/strict"

import { between, sequence } from "../dist/position.js"

/** Every key is strictly greater than the one before it. */
function assertSorted(keys: string[], message: string): void {
  for (let i = 1; i < keys.length; i++) {
    assert.ok(
      keys[i - 1]! < keys[i]!,
      `${message}: ${keys[i - 1]} is not < ${keys[i]} (index ${i - 1})`,
    )
  }
}

test("between(null, null) seeds a first key", () => {
  const only = between(null, null)
  assert.ok(only.length > 0)
})

test("sequence(n) is strictly increasing", () => {
  const keys = sequence(20)
  assert.equal(keys.length, 20)
  assertSorted(keys, "sequence")
})

test("inserting before the first key", () => {
  const keys = sequence(3)
  let first = keys[0]!

  // Prepend repeatedly: each new key must sort before the current head and
  // before every other key in the column.
  for (let i = 0; i < 60; i++) {
    const next = between(null, first)
    assert.ok(next < first, `prepend ${i}: ${next} is not < ${first}`)
    assertSorted([next, first, ...keys.slice(1)], `prepend ${i}`)
    first = next
  }
})

test("inserting after the last key", () => {
  const keys = sequence(3)
  let last = keys[keys.length - 1]!

  for (let i = 0; i < 60; i++) {
    const next = between(last, null)
    assert.ok(next > last, `append ${i}: ${next} is not > ${last}`)
    assertSorted([...keys.slice(0, -1), last, next], `append ${i}`)
    last = next
  }
})

test("inserting between two adjacent keys repeatedly, right-biased", () => {
  let [a, b] = sequence(2) as [string, string]

  // Each insert lands just left of `b`, so the gap keeps shrinking against the
  // upper bound — the case that forces the digit-carry path.
  for (let i = 0; i < 50; i++) {
    const mid = between(a, b)
    assert.ok(a < mid, `iteration ${i}: ${a} is not < ${mid}`)
    assert.ok(mid < b, `iteration ${i}: ${mid} is not < ${b}`)
    assertSorted([a, mid, b], `iteration ${i}`)
    b = mid
  }
})

test("inserting between two adjacent keys repeatedly, left-biased", () => {
  let [a, b] = sequence(2) as [string, string]

  for (let i = 0; i < 50; i++) {
    const mid = between(a, b)
    assertSorted([a, mid, b], `iteration ${i}`)
    a = mid
  }
})

test("inserting between two adjacent keys keeps the whole column ordered", () => {
  // Grow a real column: 60 inserts, each at an alternating position between an
  // existing adjacent pair, re-checking global order every time.
  const column = sequence(2)

  for (let i = 0; i < 60; i++) {
    const at = i % (column.length - 1)
    const mid = between(column[at]!, column[at + 1]!)
    column.splice(at + 1, 0, mid)
    assertSorted(column, `insert ${i}`)
  }

  assert.equal(column.length, 62)
  assert.equal(new Set(column).size, column.length, "keys must be unique")
})

test("between() throws when a >= b", () => {
  const [a, b] = sequence(2) as [string, string]

  assert.throws(() => between(b, a), /positions out of order/)
  assert.throws(() => between(a, a), /positions out of order/)
  assert.throws(() => between("z", "0"), /positions out of order/)

  // A prefix of another key sorts before it, so this pair is legal.
  assert.doesNotThrow(() => between("a", "a0"))
  assert.throws(() => between("a0", "a"), /positions out of order/)
})
