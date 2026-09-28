/**
 * Reading a command line, and refusing the ones that would cost money by
 * mistake.
 *
 * `kandy "fix the flash"` writes a note and starts an agent — the shorthand
 * the whole CLI is built around. Which means any first word kandy does not
 * know is, unless something stops it, a paid run: `kandy stauts`, `kandy
 * start`, `kandy version` all used to open a note and start an agent on it.
 * Kept apart from cli.ts, which runs on import, so the rules can be tested.
 */

/** Every command word, for guessing what a typo meant. */
export const COMMANDS = [
  "board",
  "tui",
  "serve",
  "join",
  "leave",
  "invite",
  "consent",
  "hub",
  "runner",
  "new",
  "run",
  "ls",
  "list",
  "status",
  "stats",
  "log",
  "gc",
  "open",
  "skill",
  "skills",
  "mcp",
  "help",
  "stop",
  "update",
  "setup",
] as const

/** Commands that take no words after them. Extra words were being dropped. */
export const NO_ARGS: ReadonlySet<string> = new Set([
  "board",
  "tui",
  "serve",
  "leave",
  "hub",
  "runner",
  "ls",
  "list",
  "status",
  "stats",
  "log",
  "gc",
  "open",
  "skill",
  "stop",
  "update",
  "setup",
])

/** Words people reach for that kandy spells differently, and what it calls them. */
const MEANT: Record<string, string> = {
  start: "kandy starts by itself when a command needs it — kandy serve runs it in this terminal",
  restart: "kandy stop, then any kandy command starts it again",
  version: "kandy --version",
  doctor: "kandy status shows the daemon and which agents are ready",
  init: "kandy setup — and a repo becomes a board the first time you write a note in it",
  logs: "kandy log",
  ps: "kandy ls",
  add: 'kandy new "…" writes a note without running it',
  upgrade: "kandy update",
  kill: "kandy stop",
  quit: "kandy stop",
}

/**
 * Edit distance, counting two swapped letters as one edit — the typo people
 * actually make: `stauts` is one slip from status, not two. Words here are
 * short, so the whole table is fine.
 */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1)
      d[i]![j] = best
    }
  }
  return d[a.length]![b.length]!
}

/** The candidate a word is most likely a typo of, if any is close enough. */
export function closest(word: string, candidates: readonly string[]): string | null {
  const w = word.toLowerCase()
  // One edit in a short word, two in a longer one: `stauts` is status,
  // `lg` is not gc.
  const limit = w.length <= 4 ? 1 : 2
  let best: { c: string; d: number } | null = null
  for (const c of candidates) {
    const d = distance(w, c)
    if (d <= limit && (!best || d < best.d)) best = { c, d }
  }
  return best?.c ?? null
}

/**
 * What to say to a first word that is not a command, or null if it is a note.
 *
 * Only a single word is refused. Anything with a space in it — quoted or
 * typed out — is a sentence, and a sentence is a note.
 */
export function unknownCommand(words: readonly string[]): { error: string; hint: string } | null {
  if (words.length !== 1) return null
  const word = words[0]!
  if (/\s/.test(word) || word === "") return null
  const meant = MEANT[word.toLowerCase()]
  const guess = meant ? null : closest(word, COMMANDS)
  return {
    error: `unknown command '${word}'` + (meant ? ` — ${meant}` : guess ? ` — did you mean kandy ${guess}?` : ""),
    hint: `to write a note: kandy new ${word}, or quote a sentence: kandy "${word} …"`,
  }
}

/**
 * Words given to a command that takes none, and what to say about them.
 *
 * `kandy status bar looks wrong` ran status and dropped the rest; `kandy stop
 * the flicker` stopped the daemon. Both were someone writing a note.
 */
export function extraWords(command: string, words: readonly string[]): string | null {
  if (!NO_ARGS.has(command) || words.length === 0) return null
  const sentence = [command, ...words].join(" ")
  return `${command} takes no arguments — to write a note, quote it: kandy "${sentence}"`
}

/** Whether an argument is a flag. `"-x flag crashes"` has spaces: it is a note. */
export function isFlag(arg: string): boolean {
  return arg.startsWith("-") && arg.length > 1 && !/\s/.test(arg)
}

/**
 * What to say about an `--agent` kandy has no adapter for, or null if it has.
 *
 * `--agent claud` used to print "running with claud" and then fail the note
 * with "no adapter" — after a board, a note and a worktree had been made.
 */
export function unknownAgent(agent: string, known: readonly string[]): string | null {
  if (known.includes(agent)) return null
  const aka: Record<string, string> = { "claude-code": "claude", "cursor-agent": "cursor", agent: "cursor" }
  const guess = aka[agent.toLowerCase()] ?? closest(agent, known)
  return (
    `no agent called '${agent}'` +
    (guess ? ` — did you mean --agent ${guess}?` : ` — kandy can run ${known.join(", ")}`)
  )
}

/**
 * A flag that takes a value, given none — or given the next flag instead.
 *
 * `--agent --port 4510` made the agent "--port" and put 4510 in the note's
 * title. A value that looks like a flag is never meant as one.
 */
export function badValue(argv: readonly string[], valued: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!valued.includes(a)) continue
    const v = argv[i + 1]
    if (v === undefined) return `${a} needs a value`
    if (isFlag(v)) return `${a} needs a value — got ${v}`
    i++
  }
  return null
}
