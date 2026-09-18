import test from "node:test"
import assert from "node:assert/strict"
import { describeFamilies, formatVariant, parseVariant, resolveVariant } from "../dist/model-variants.js"

/*
 * Real ids from `cursor-agent models` on 2026.09.15. The whole catalogue is
 * 224 of these; the sample below carries every shape in it.
 */
const REAL = `auto
composer-2.5
composer-2.5-fast
claude-opus-5
claude-opus-5-low
claude-opus-5-low-fast
claude-opus-5-medium
claude-opus-5-high-fast
claude-opus-5-thinking-high
claude-opus-5-thinking-xhigh-fast
claude-opus-5-thinking-max
cursor-grok-4.6-low
cursor-grok-4.6-high
cursor-grok-4.6-xhigh-fast
gpt-5.3-codex
gpt-5.3-codex-low-fast
gpt-5.3-codex-high
gpt-5.3-codex-xhigh-fast`
  .split("\n")
  .map((s) => s.trim())

test("every real id survives a round trip", () => {
  // The id is what --model is handed. A picker that cannot reproduce it
  // exactly is a picker that silently runs a different model.
  for (const id of REAL) {
    assert.equal(formatVariant(parseVariant(id)), id, id)
  }
})

test("the knobs come back out in the right order", () => {
  assert.deepEqual(parseVariant("claude-opus-5-thinking-xhigh-fast"), {
    family: "claude-opus-5",
    effort: "xhigh",
    thinking: true,
    fast: true,
  })
  assert.deepEqual(parseVariant("auto"), {
    family: "auto",
    effort: null,
    thinking: false,
    fast: false,
  })
})

test("a family carries only the knobs it actually has", () => {
  const fams = describeFamilies(REAL)
  const codex = fams.find((f) => f.family === "gpt-5.3-codex")
  assert.ok(codex)
  // No medium in the real catalogue for this one, and offering it would offer
  // a model the account cannot run.
  assert.deepEqual(codex.efforts, ["low", "high", "xhigh"])
  assert.equal(codex.thinking, false)
  assert.equal(codex.fast, true)
  assert.equal(codex.base, "gpt-5.3-codex")

  const opus = fams.find((f) => f.family === "claude-opus-5")
  assert.ok(opus)
  assert.equal(opus.thinking, true)
  assert.deepEqual(opus.efforts, ["low", "medium", "high", "xhigh", "max"])
})

test("224 ids are 50 models, which is the point", () => {
  const fams = describeFamilies(REAL)
  assert.ok(fams.length < REAL.length / 2, `${fams.length} families from ${REAL.length} ids`)
})

test("turning a knob never composes an id the account cannot run", () => {
  const fams = describeFamilies(REAL)
  const codex = fams.find((f) => f.family === "gpt-5.3-codex")!

  // Carrying "max" over from another family, which this one stops short of.
  assert.equal(resolveVariant(codex, { effort: "max" }), "gpt-5.3-codex")
  // Asking for thinking where there is none.
  assert.equal(resolveVariant(codex, { effort: "high", thinking: true }), "gpt-5.3-codex-high")
  // And one that does compose.
  assert.equal(resolveVariant(codex, { effort: "xhigh", fast: true }), "gpt-5.3-codex-xhigh-fast")
})

test("a model with no variants is left exactly as it is", () => {
  const fams = describeFamilies(["auto"])
  assert.deepEqual(fams[0]!.efforts, [])
  assert.equal(resolveVariant(fams[0]!, { effort: "high", fast: true }), "auto")
})
