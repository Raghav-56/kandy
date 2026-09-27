import test from "node:test"
import assert from "node:assert/strict"

import { choose, step } from "../dist/cli/choose.js"

test("arrows move and wrap; enter picks what's highlighted", () => {
  assert.deepEqual(step(0, 3, undefined, { name: "down" }), { at: 1, done: false })
  assert.deepEqual(step(0, 3, undefined, { name: "up" }), { at: 2, done: false }, "wraps to the last")
  assert.deepEqual(step(2, 3, undefined, { name: "down" }), { at: 0, done: false }, "wraps to the first")
  assert.deepEqual(step(1, 3, "j", { name: "j" }), { at: 2, done: false })
  assert.deepEqual(step(1, 3, "\r", { name: "return" }), { at: 1, done: true })
})

test("a number still picks at once; anything else does nothing", () => {
  assert.deepEqual(step(0, 3, "2", { name: "2" }), { at: 1, done: true })
  assert.deepEqual(step(0, 3, "4", { name: "4" }), { at: 0, done: false }, "no fourth answer")
  assert.deepEqual(step(0, 3, "x", { name: "x" }), { at: 0, done: false })
  assert.equal(step(0, 3, undefined, { name: "c", ctrl: true }).quit, true)
})

test("with no terminal to read keys from, the default is the answer", async () => {
  // Under node --test stdin is not a TTY: nothing drawn, nothing waited on.
  assert.equal(await choose([{ label: "a" }, { label: "b" }], 1), 1)
})
