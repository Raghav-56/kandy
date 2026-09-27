/**
 * Key → action, per screen, as a table. The footer's hints and the help
 * screen are generated from the same table, so a key cannot work without
 * being documented or be documented without working.
 */
import type { KeyLike } from "./editor.js"
import { textWidth } from "./text.js"

export type ScreenKind = "board" | "note" | "diff" | "help" | "team"

export type Action =
  | { type: "quit" }
  | { type: "back" }
  | { type: "help" }
  | { type: "boards" }
  | { type: "move"; by: number }
  | { type: "page"; by: 1 | -1 }
  | { type: "top" }
  | { type: "bottom" }
  | { type: "open" }
  | { type: "new"; run: boolean }
  | { type: "run" }
  | { type: "cancel" }
  | { type: "filter" }
  | { type: "clearFilter" }
  | { type: "message" }
  | { type: "diff" }
  | { type: "merge" }
  | { type: "discard" }
  | { type: "revise" }
  | { type: "give" }
  | { type: "allow"; scope: "once" | "note" }
  | { type: "deny" }
  | { type: "consent"; accept: boolean; always: boolean }
  | { type: "file"; dir: 1 | -1 }
  | { type: "column"; by: 1 | -1 }
  | { type: "shift"; dx: number; dy: number }
  | { type: "edit" }
  | { type: "delete" }
  | { type: "policy" }
  | { type: "view" }
  | { type: "team" }
  | { type: "boardStep"; by: 1 | -1 }
  | { type: "addBoard" }
  | { type: "invite" }
  | { type: "role" }
  | { type: "consentSetting" }
  | { type: "refresh" }

/** What the current screen knows that changes which keys mean something. */
export type KeyCtx = {
  screen: ScreenKind
  hub: boolean
  /** A filter is applied on the board. */
  filtering: boolean
  /** The focused note has a pending permission prompt. */
  prompt: boolean
  /** The focused note is held for a machine the viewer owns. */
  heldMine: boolean
  /** There is a focused note at all. */
  note: boolean
  /**
   * Where the focused note is in its life, for deciding which hints are worth
   * the footer's space. Keys still work outside it; the server has the last word.
   */
  stage: Stage | null
  /** The focused note's last run failed, so running it again is a retry. */
  failed?: boolean
  /** The board is drawn as columns side by side (not the one-column list). */
  kanban?: boolean
  /** Team screen: the viewer can admit people and change roles. */
  owner?: boolean
  /** Team screen: a person is selected. */
  member?: boolean
}

export type Stage = "idle" | "live" | "review" | "done"

export function stageOf(status: string | null | undefined): Stage | null {
  switch (status) {
    case "draft":
      return "idle"
    case "queued":
    case "running":
    case "blocked":
      return "live"
    case "review":
    case "failed":
      return "review"
    case "done":
      return "done"
    default:
      return null
  }
}

type Binding = {
  /** Displayed key. */
  label: string
  /** Short hint for the footer; omitted bindings only appear in help. */
  hint?: string
  /** Longer text for the help screen. */
  help: string
  match: (input: string, key: KeyLike) => boolean
  action: (ctx: KeyCtx) => Action | null
  /** When this binding applies at all. */
  when?: (ctx: KeyCtx) => boolean
  /** Shown in the footer (defaults to having a hint and `when`). */
  footer?: boolean
  /** Further narrows when the hint (not the key) is shown. */
  show?: (ctx: KeyCtx) => boolean
  /** Someone is waiting on this answer: its hint goes first. */
  urgent?: boolean
}

const at =
  (...stages: Stage[]) =>
  (c: KeyCtx) =>
    c.stage !== null && stages.includes(c.stage)

const ch = (c: string) => (input: string, key: KeyLike) => input === c && !key.ctrl && !key.meta
const up = (input: string, key: KeyLike) => !!key.upArrow || ch("k")(input, key)
const down = (input: string, key: KeyLike) => !!key.downArrow || ch("j")(input, key)
const pgUp = (input: string, key: KeyLike) => !!key.pageUp || (!!key.ctrl && input === "u")
const pgDn = (input: string, key: KeyLike) => !!key.pageDown || (!!key.ctrl && input === "d") || ch(" ")(input, key)

const left = (i: string, k: KeyLike) => !!k.leftArrow || ch("h")(i, k)
const right = (i: string, k: KeyLike) => !!k.rightArrow || ch("l")(i, k)
const kanban = (c: KeyCtx) => c.kanban === true

const BOARD: Binding[] = [
  { label: "←→↑↓", hint: "move", help: "Move between cards (also h j k l); ←→ changes column", match: (i, k) => up(i, k) || down(i, k) || ((left(i, k) || right(i, k)) && !k.shift), action: () => null, when: kanban },
  { label: "↑↓", hint: "move", help: "Move (also j / k, PgUp / PgDn)", match: (i, k) => up(i, k) || down(i, k), action: () => null, when: (c) => !kanban(c) },
  // Shifted first, so shift+← isn't read as ←.
  { label: "H L", help: "Move the card to the next column (also shift+← →, < >): runs a draft, merges a review", match: (i, k) => ch("H")(i, k) || ch("<")(i, k) || (!!k.shift && !!k.leftArrow), action: () => ({ type: "shift", dx: -1, dy: 0 }), when: (c) => kanban(c) && c.note },
  { label: "", help: "", match: (i, k) => ch("L")(i, k) || ch(">")(i, k) || (!!k.shift && !!k.rightArrow), action: () => ({ type: "shift", dx: 1, dy: 0 }), footer: false, when: (c) => kanban(c) && c.note },
  { label: "J K", help: "Move the card down / up its column (also shift+↓ ↑)", match: (i, k) => ch("K")(i, k) || (!!k.shift && !!k.upArrow), action: () => ({ type: "shift", dx: 0, dy: -1 }), when: (c) => kanban(c) && c.note },
  { label: "", help: "", match: (i, k) => ch("J")(i, k) || (!!k.shift && !!k.downArrow), action: () => ({ type: "shift", dx: 0, dy: 1 }), footer: false, when: (c) => kanban(c) && c.note },
  { label: "", help: "", match: up, action: () => ({ type: "move", by: -1 }), footer: false },
  { label: "", help: "", match: down, action: () => ({ type: "move", by: 1 }), footer: false },
  { label: "", help: "", match: left, action: () => ({ type: "column", by: -1 }), footer: false, when: kanban },
  { label: "", help: "", match: right, action: () => ({ type: "column", by: 1 }), footer: false, when: kanban },
  { label: "", help: "", match: pgUp, action: () => ({ type: "page", by: -1 }), footer: false },
  { label: "", help: "", match: pgDn, action: () => ({ type: "page", by: 1 }), footer: false },
  { label: "g G", help: "First / last card (also Home / End)", match: (i, k) => ch("g")(i, k) || !!k.home, action: () => ({ type: "top" }), footer: false },
  { label: "", help: "", match: (i, k) => ch("G")(i, k) || !!k.end, action: () => ({ type: "bottom" }), footer: false },
  // After ← →'s column bindings: on the kanban they change column, and only
  // the list view reaches this with → to open.
  { label: "enter", hint: "open", help: "Open the note (also o; → in the list view; double-click)", match: (i, k) => !!k.return || ch("o")(i, k) || !!k.rightArrow || ch("l")(i, k), action: () => ({ type: "open" }), when: (c) => c.note },
  { label: "a", hint: "allow", help: "Allow the pending prompt once", match: ch("a"), action: () => ({ type: "allow", scope: "once" }), urgent: true, when: (c) => c.prompt },
  { label: "A", help: "Allow for this note (don't ask again)", match: ch("A"), action: () => ({ type: "allow", scope: "note" }), urgent: true, when: (c) => c.prompt },
  { label: "D", hint: "deny", help: "Deny the pending prompt, with an optional comment", match: ch("D"), action: () => ({ type: "deny" }), urgent: true, when: (c) => c.prompt },
  { label: "y", hint: "run it here", help: "Someone wants to run this on your machine: run it", match: ch("y"), action: () => ({ type: "consent", accept: true, always: false }), urgent: true, when: (c) => c.heldMine },
  { label: "Y", help: "…and always allow that person", match: ch("Y"), action: () => ({ type: "consent", accept: true, always: true }), urgent: true, when: (c) => c.heldMine },
  { label: "D", hint: "decline", help: "Someone wants to run this on your machine: decline", match: ch("D"), action: () => ({ type: "consent", accept: false, always: false }), urgent: true, when: (c) => c.heldMine && !c.prompt },
  { label: "n", hint: "new", help: "New note and run it with the board's last agent", match: ch("n"), action: () => ({ type: "new", run: true }) },
  { label: "N", help: "New note without running it", match: ch("N"), action: () => ({ type: "new", run: false }) },
  { label: "r", hint: "run", help: "Run the note (asks which agent if it has none)", match: ch("r"), action: () => ({ type: "run" }), when: (c) => c.note, show: at("idle") },
  { label: "r", hint: "retry", help: "Run a failed note again", match: ch("r"), action: () => ({ type: "run" }), when: (c) => c.note && c.failed === true },
  { label: "x", hint: "cancel", help: "Cancel the note's run", match: ch("x"), action: () => ({ type: "cancel" }), when: (c) => c.note, show: at("live") },
  { label: "m", hint: "message", help: "Message the agent (while it runs, or to send it back)", match: ch("m"), action: () => ({ type: "message" }), when: (c) => c.note, show: at("live") },
  { label: "d", hint: "diff", help: "Diff of the note", match: ch("d"), action: () => ({ type: "diff" }), when: (c) => c.note, show: at("review") },
  { label: "M", hint: "merge", help: "Merge (asks to confirm)", match: ch("M"), action: () => ({ type: "merge" }), when: (c) => c.note, show: at("review") },
  { label: "R", hint: "revise", help: "Send back with a comment", match: ch("R"), action: () => ({ type: "revise" }), when: (c) => c.note, show: at("review") },
  { label: "X", help: "Discard (asks to confirm)", match: ch("X"), action: () => ({ type: "discard" }), when: (c) => c.note },
  { label: "e", help: "Edit the note's title and detail", match: ch("e"), action: () => ({ type: "edit" }), when: (c) => c.note },
  { label: "del", help: "Delete the note (asks to confirm; also backspace)", match: (_i, k) => !!k.delete || !!k.backspace, action: () => ({ type: "delete" }), when: (c) => c.note },
  { label: "p", help: "Switch the note between repo only and full access", match: ch("p"), action: () => ({ type: "policy" }), when: (c) => c.note },
  { label: "/", hint: "filter", help: "Filter notes by text", match: ch("/"), action: () => ({ type: "filter" }) },
  { label: "[ ]", hint: "boards", help: "Previous / next board (b to pick one, B to add one; or click a tab)", match: ch("]"), action: () => ({ type: "boardStep", by: 1 }) },
  { label: "", help: "", match: ch("["), action: () => ({ type: "boardStep", by: -1 }), footer: false },
  { label: "b", help: "Pick a board", match: ch("b"), action: () => ({ type: "boards" }) },
  { label: "B", help: "Add a board: a repository on this machine", match: ch("B"), action: () => ({ type: "addBoard" }) },
  { label: "t", hint: "team", help: "Team: people, machines, activity, who may run notes here", match: ch("t"), action: () => ({ type: "team" }) },
  { label: "v", help: "Switch between columns and a single list", match: ch("v"), action: () => ({ type: "view" }) },
  { label: "?", hint: "help", help: "All keys", match: ch("?"), action: () => ({ type: "help" }) },
  { label: "esc", hint: "clear filter", help: "Clear the filter", match: (_i, k) => !!k.escape, action: () => ({ type: "clearFilter" }), when: (c) => c.filtering },
  { label: "q", hint: "quit", help: "Quit (also esc, ctrl+c)", match: (i, k) => ch("q")(i, k) || !!k.escape, action: () => ({ type: "quit" }) },
]

const NOTE: Binding[] = [
  { label: "↑↓", hint: "scroll", help: "Scroll the transcript (j / k, PgUp / PgDn; G follows)", match: (i, k) => up(i, k) || down(i, k), action: () => null },
  { label: "", help: "", match: up, action: () => ({ type: "move", by: -1 }), footer: false },
  { label: "", help: "", match: down, action: () => ({ type: "move", by: 1 }), footer: false },
  { label: "", help: "", match: pgUp, action: () => ({ type: "page", by: -1 }), footer: false },
  { label: "", help: "", match: pgDn, action: () => ({ type: "page", by: 1 }), footer: false },
  { label: "", help: "", match: (_i, k) => !!k.home, action: () => ({ type: "top" }), footer: false },
  { label: "G", help: "Jump to the end and follow (also End)", match: (i, k) => ch("G")(i, k) || !!k.end, action: () => ({ type: "bottom" }), footer: false },
  { label: "a", hint: "allow", help: "Allow the pending prompt once", match: ch("a"), action: () => ({ type: "allow", scope: "once" }), urgent: true, when: (c) => c.prompt },
  { label: "A", hint: "allow for note", help: "Allow for this note (don't ask again)", match: ch("A"), action: () => ({ type: "allow", scope: "note" }), urgent: true, when: (c) => c.prompt },
  { label: "D", hint: "deny", help: "Deny the pending prompt, with an optional comment", match: ch("D"), action: () => ({ type: "deny" }), urgent: true, when: (c) => c.prompt },
  { label: "y", hint: "run it", help: "Held on your machine: run it", match: ch("y"), action: () => ({ type: "consent", accept: true, always: false }), urgent: true, when: (c) => c.heldMine },
  { label: "Y", hint: "always allow", help: "Held on your machine: always allow this person", match: ch("Y"), action: () => ({ type: "consent", accept: true, always: true }), urgent: true, when: (c) => c.heldMine },
  { label: "n", hint: "decline", help: "Held on your machine: decline", match: ch("n"), action: () => ({ type: "consent", accept: false, always: false }), urgent: true, when: (c) => c.heldMine },
  { label: "r", hint: "run", help: "Run (asks which agent if it has none)", match: ch("r"), action: () => ({ type: "run" }), show: at("idle") },
  { label: "r", hint: "retry", help: "Run a failed note again", match: ch("r"), action: () => ({ type: "run" }), when: (c) => c.failed === true },
  { label: "m", hint: "message", help: "Message / steer the agent", match: ch("m"), action: () => ({ type: "message" }), show: at("live", "review") },
  { label: "d", hint: "diff", help: "Diff", match: ch("d"), action: () => ({ type: "diff" }), show: at("live", "review", "done") },
  { label: "x", hint: "cancel", help: "Cancel the run", match: ch("x"), action: () => ({ type: "cancel" }), show: at("live") },
  { label: "M", hint: "merge", help: "Merge (asks to confirm)", match: ch("M"), action: () => ({ type: "merge" }), show: at("review") },
  { label: "R", hint: "revise", help: "Send back with a comment", match: ch("R"), action: () => ({ type: "revise" }), show: at("review") },
  { label: "X", hint: "discard", help: "Discard (asks to confirm)", match: ch("X"), action: () => ({ type: "discard" }), show: at("review") },
  { label: "g", hint: "give", help: "Give to another machine", match: ch("g"), action: () => ({ type: "give" }), when: (c) => c.hub },
  { label: "e", help: "Edit the note's title and detail", match: ch("e"), action: () => ({ type: "edit" }) },
  { label: "p", help: "Switch between repo only and full access", match: ch("p"), action: () => ({ type: "policy" }) },
  { label: "del", help: "Delete the note (asks to confirm; also backspace)", match: (_i, k) => !!k.delete || !!k.backspace, action: () => ({ type: "delete" }) },
  { label: "b", help: "Switch board", match: ch("b"), action: () => ({ type: "boards" }) },
  { label: "?", help: "All keys", match: ch("?"), action: () => ({ type: "help" }) },
  { label: "q", hint: "back", help: "Back to the board (also esc, ←)", match: (i, k) => ch("q")(i, k) || !!k.escape || !!k.leftArrow || ch("h")(i, k), action: () => ({ type: "back" }) },
]

const DIFF: Binding[] = [
  { label: "↑↓", hint: "scroll", help: "Scroll (j / k, PgUp / PgDn, space)", match: (i, k) => up(i, k) || down(i, k), action: () => null },
  { label: "", help: "", match: up, action: () => ({ type: "move", by: -1 }), footer: false },
  { label: "", help: "", match: down, action: () => ({ type: "move", by: 1 }), footer: false },
  { label: "", help: "", match: pgUp, action: () => ({ type: "page", by: -1 }), footer: false },
  { label: "", help: "", match: pgDn, action: () => ({ type: "page", by: 1 }), footer: false },
  { label: "g G", help: "Top / bottom (also Home / End)", match: (i, k) => ch("g")(i, k) || !!k.home, action: () => ({ type: "top" }), footer: false },
  { label: "", help: "", match: (i, k) => ch("G")(i, k) || !!k.end, action: () => ({ type: "bottom" }), footer: false },
  { label: "] [", hint: "next/prev file", help: "Next / previous file", match: (i, k) => ch("]")(i, k), action: () => ({ type: "file", dir: 1 }) },
  { label: "", help: "", match: ch("["), action: () => ({ type: "file", dir: -1 }), footer: false },
  { label: "M", hint: "merge", help: "Merge (asks to confirm)", match: ch("M"), action: () => ({ type: "merge" }), show: at("review") },
  { label: "X", help: "Discard (asks to confirm)", match: ch("X"), action: () => ({ type: "discard" }) },
  { label: "?", help: "All keys", match: ch("?"), action: () => ({ type: "help" }) },
  { label: "q", hint: "back", help: "Back (also esc, ←)", match: (i, k) => ch("q")(i, k) || !!k.escape || !!k.leftArrow, action: () => ({ type: "back" }) },
]

const HELP: Binding[] = [
  { label: "", help: "", match: up, action: () => ({ type: "move", by: -1 }), footer: false },
  { label: "", help: "", match: down, action: () => ({ type: "move", by: 1 }), footer: false },
  { label: "", help: "", match: pgUp, action: () => ({ type: "page", by: -1 }), footer: false },
  { label: "", help: "", match: pgDn, action: () => ({ type: "page", by: 1 }), footer: false },
  { label: "q", hint: "back", help: "Back", match: (i, k) => ch("q")(i, k) || ch("?")(i, k) || !!k.escape, action: () => ({ type: "back" }) },
]

const TEAM: Binding[] = [
  { label: "↑↓", hint: "move", help: "Move between people", match: (i, k) => up(i, k) || down(i, k), action: () => null, when: (c) => c.owner === true },
  { label: "", help: "", match: up, action: () => ({ type: "move", by: -1 }), footer: false },
  { label: "", help: "", match: down, action: () => ({ type: "move", by: 1 }), footer: false },
  { label: "i", hint: "invite", help: "Add someone to the team, and get the message to send them", match: ch("i"), action: () => ({ type: "invite" }), when: (c) => c.owner === true },
  { label: "enter", hint: "role", help: "Change the selected person's role, or remove them", match: (_i, k) => !!k.return, action: () => ({ type: "role" }), when: (c) => c.owner === true && c.member === true },
  { label: "c", hint: "who runs here", help: "Who may run notes on this machine: nobody, people you approve, or the team", match: ch("c"), action: () => ({ type: "consentSetting" }) },
  { label: "r", hint: "refresh", help: "Refresh", match: ch("r"), action: () => ({ type: "refresh" }) },
  { label: "?", help: "All keys", match: ch("?"), action: () => ({ type: "help" }) },
  { label: "q", hint: "back", help: "Back to the board (also esc, t)", match: (i, k) => ch("q")(i, k) || ch("t")(i, k) || !!k.escape, action: () => ({ type: "back" }) },
]

const TABLE: Record<ScreenKind, Binding[]> = { board: BOARD, note: NOTE, diff: DIFF, help: HELP, team: TEAM }

/**
 * Terminals deliver keys typed faster than they are read as one chunk
 * ("jjj"). A run of one key is that key, repeated; anything else is read as
 * its first key, so a stray burst can never trigger a string of commands.
 */
export function splitBurst(input: string): { input: string; count: number } {
  const chars = [...input]
  if (chars.length <= 1) return { input, count: 1 }
  const first = chars[0]!
  return { input: first, count: chars.every((c) => c === first) ? chars.length : 1 }
}

/** The action for a key on this screen, or null if it means nothing here. */
export function keyAction(ctx: KeyCtx, rawInput: string, key: KeyLike): Action | null {
  if (key.ctrl && rawInput === "c") return { type: "quit" }
  const { input, count } = key.ctrl || key.meta ? { input: rawInput, count: 1 } : splitBurst(rawInput)
  const a = matchKey(ctx, input, key)
  if (a && a.type === "move" && count > 1) return { type: "move", by: a.by * count }
  return a
}

function matchKey(ctx: KeyCtx, input: string, key: KeyLike): Action | null {
  for (const b of TABLE[ctx.screen]) {
    if (b.when && !b.when(ctx)) continue
    if (!b.match(input, key)) continue
    const a = b.action(ctx)
    if (a) return a
  }
  return null
}

export type Hint = { key: string; label: string; action?: Action | null }

/** Footer hints for this screen, most specific first. */
export function hints(ctx: KeyCtx): Hint[] {
  const urgent: Hint[] = []
  const rest: Hint[] = []
  for (const b of TABLE[ctx.screen]) {
    if (b.footer === false || !b.hint) continue
    if (b.when && !b.when(ctx)) continue
    if (b.show && !b.show(ctx)) continue
    // What's urgent goes first: an answer someone is waiting for.
    ;(b.urgent ? urgent : rest).push({ key: b.label, label: b.hint, action: b.action(ctx) })
  }
  return [...urgent, ...rest]
}

/** Everything, for the help screen, grouped by screen. */
export function helpSections(): { title: string; keys: Hint[] }[] {
  const section = (title: string, bs: Binding[]) => ({
    title,
    keys: bs.filter((b) => b.label && b.help).map((b) => ({ key: b.label, label: b.help })),
  })
  return [
    section("Board", BOARD),
    section("Note", NOTE),
    section("Diff", DIFF),
    section("Team", TEAM),
    {
      title: "Anywhere",
      keys: [
        { key: "?", label: "Help" },
        { key: "ctrl+c", label: "Quit" },
        { key: "in inputs", label: "enter submits · esc cancels · ctrl+j / alt+enter newline" },
        { key: "mouse", label: "click a card to select it, double-click to open, drag it to another column, scroll a column with the wheel; click a tab or a hint" },
        { key: "selecting", label: "hold shift (option in some macOS terminals) to select text while the mouse is on — or KANDY_NO_MOUSE=1" },
      ],
    },
  ]
}

/**
 * Key hints, as many as fit. `?` is always kept when anything is dropped —
 * it is the way to find what was dropped.
 */
export function fitHints(hints: readonly Hint[], width: number): Hint[] {
  const cost = (h: Hint) => textWidth(h.key) + 1 + textWidth(h.label) + 2
  const total = (hs: readonly Hint[]) => 1 + hs.reduce((n, h) => n + cost(h), 0)
  if (total(hints) <= width) return [...hints]
  const help = hints.find((h) => h.key === "?")
  const rest = hints.filter((h) => h !== help)
  const out: Hint[] = []
  const budget = width - (help ? cost(help) : 0)
  for (const h of rest) {
    if (total([...out, h]) > budget) break
    out.push(h)
  }
  return help ? [...out, help] : out
}
