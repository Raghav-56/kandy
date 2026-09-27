import test from "node:test"
import assert from "node:assert/strict"

import { clickCounter, isMouse, mouseWanted, parseMouse } from "../dist/tui/mouse.js"

test("a press, a release and a drag read as what they are, at 0-based cells", () => {
  // As Ink hands them to useInput: the escape already stripped.
  assert.deepEqual(parseMouse("[<0;12;5M"), { type: "down", button: "left", x: 11, y: 4, shift: false, alt: false, ctrl: false })
  assert.deepEqual(parseMouse("[<0;12;5m"), { type: "up", button: "left", x: 11, y: 4, shift: false, alt: false, ctrl: false })
  assert.equal(parseMouse("[<32;20;9M")?.type, "drag")
  assert.equal(parseMouse("[<2;1;1M")?.type === "down" && parseMouse("[<2;1;1M")?.button, "right")
  // With the escape still on, too.
  assert.equal(parseMouse("\x1b[<0;1;1M")?.type, "down")
})

test("the wheel and modifiers", () => {
  assert.deepEqual(parseMouse("[<64;3;4M"), { type: "wheel", dir: "up", x: 2, y: 3, shift: false, alt: false, ctrl: false })
  assert.equal(parseMouse("[<65;3;4M")?.type === "wheel" && parseMouse("[<65;3;4M")?.dir, "down")
  const shifted = parseMouse("[<4;1;1M")!
  assert.equal(shifted.shift, true)
  assert.equal(parseMouse("[<16;1;1M")!.ctrl, true)
})

test("anything else is not the mouse — keys keep working", () => {
  for (const s of ["q", "[", "[A", "\x1b", "[<0;1M", "[<x;1;1M", ""]) {
    assert.equal(isMouse(s), false, JSON.stringify(s))
    assert.equal(parseMouse(s), null)
  }
  assert.equal(isMouse("[<0;1;1M"), true)
})

test("two presses of the same thing, close together, are a double click", () => {
  const count = clickCounter(400)
  assert.equal(count("card:a", 1000), 1)
  assert.equal(count("card:a", 1300), 2)
  assert.equal(count("card:a", 2000), 1, "too slow")
  assert.equal(count("card:b", 2100), 1, "a different card")
})

test("the mouse can be turned off, and is never asked for without a terminal", () => {
  assert.equal(mouseWanted({}, true), true)
  assert.equal(mouseWanted({ KANDY_NO_MOUSE: "1" }, true), false)
  assert.equal(mouseWanted({ KANDY_NO_MOUSE: "0" }, true), true)
  assert.equal(mouseWanted({}, false), false)
})

test("on Windows the mouse is left to the terminal unless asked for", () => {
  // Node drops the Windows console's mouse events; asking for them only
  // takes text selection away.
  assert.equal(mouseWanted({}, true, "win32"), false)
  assert.equal(mouseWanted({ KANDY_MOUSE: "1" }, true, "win32"), true)
  assert.equal(mouseWanted({}, true, "darwin"), true)
})
