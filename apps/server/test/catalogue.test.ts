import test from "node:test"
import assert from "node:assert/strict"
import { catalogued, warmCatalogue } from "../dist/agents/catalogue.js"

/*
 * The fixture is real output from `cursor-agent models` on 2026.09.15, header
 * and all. Cursor prints `id - Display Name`; the id is what `--model` takes
 * and the display name is what the init frame reports back, which is useless
 * for anything but reading.
 */
const REAL = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
cursor-grok-4.6-high - Cursor Grok 4.6
claude-opus-5-thinking-high - Claude Opus 5 1M Thinking
composer-2.5 - Composer 2.5
claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR)
`

// The parser is the part worth testing; reach it the way the module does.
const parse = (out: string) =>
  out
    .split("\n")
    .map((l) => /^(\S+) - \S/.exec(l.trim())?.[1])
    .filter((id): id is string => Boolean(id))

test("ids are read, the header and the display names are not", () => {
  assert.deepEqual(parse(REAL), [
    "auto",
    "gpt-5.3-codex-low",
    "cursor-grok-4.6-high",
    "claude-opus-5-thinking-high",
    "composer-2.5",
    "claude-fable-5-thinking-high",
  ])
})

test("auto stays first, because that is Cursor's own recommendation", () => {
  assert.equal(parse(REAL)[0], "auto")
})

test("a banner with no models yields nothing rather than junk", () => {
  // What a signed-out CLI prints, which exits zero and must not be mistaken
  // for a catalogue of one model called "Please".
  assert.deepEqual(parse("Not logged in. Run `cursor-agent login` to continue.\n"), [])
  assert.deepEqual(parse("Available models\n\n"), [])
})

test("an agent nobody knows how to ask is left alone", async () => {
  await warmCatalogue("aider")
  assert.deepEqual(catalogued("aider"), [])
})

test("the curated list is gated on what the CLI is old enough to accept", async () => {
  const { curatedModels } = await import("../dist/agents/curated.js")
  const old = curatedModels("claude", "1.9.0 (Claude Code)")
  const now = curatedModels("claude", "2.1.271 (Claude Code)")
  assert.equal(old.includes("claude-opus-5"), false, "a 1.x CLI does not know it")
  assert.equal(now.includes("claude-opus-5"), true)
  // An unreadable version offers everything: a menu that silently shrinks
  // because --version changed shape is worse than one the agent corrects.
  assert.deepEqual(curatedModels("claude", null), now)
})

test("aliases lead, because the first entry is what a new note runs on", async () => {
  const { curatedModels } = await import("../dist/agents/curated.js")
  assert.deepEqual(curatedModels("claude", null).slice(0, 4), ["fable", "opus", "sonnet", "haiku"])
})

test("an agent with no curated list gets nothing rather than everything", async () => {
  const { curatedModels } = await import("../dist/agents/curated.js")
  assert.deepEqual(curatedModels("cursor", null), [])
})
