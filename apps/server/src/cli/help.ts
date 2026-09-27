import { banner, bold, dim, faint, lemon, mint } from "./banner.js"
import { joinedHub } from "../joined.js"

/**
 * `kandy -h`, `kandy help`, `kandy help <topic>`, `kandy <command> --help`.
 *
 * The front page is short on purpose. It used to be seventy-nine lines — every
 * command, every flag, three paragraphs — which is a manual, and nobody reads
 * a manual to find the one command they came for. So the front page says
 * what mode this machine is in, the three things people actually start with,
 * the rest grouped by what it is for, and where the detail is. The detail
 * lives in topics and per-command pages, one keystroke away.
 */

const out = (s = "") => process.stdout.write(s + "\n")
const W = 30

function row(cmd: string, desc: string): string {
  return cmd.length >= W ? `    ${bold(cmd)}\n    ${" ".repeat(W)}${faint(desc)}` : `    ${bold(cmd.padEnd(W))}${faint(desc)}`
}
function head(t: string): string {
  return `\n  ${dim(t.toUpperCase())}`
}

/** One line saying which kandy this is — read from config only, so help never waits on a network. */
function mode(): string {
  const hub = joinedHub()
  if (hub) {
    return `  ${dim("you're")}  ${mint("on a team")} ${dim(hub.url)}${hub.email ? dim(` as ${hub.email}`) : ""}`
  }
  return `  ${dim("you're")}  ${bold("on this machine")} ${faint("— just you. Joining a team: kandy join <hub-url>")}`
}

export async function printHelp(topic?: string): Promise<number> {
  if (topic) return printTopic(topic)

  process.stdout.write(banner())
  out(mode())

  out(head("start here"))
  out(row('kandy "fix the login flash"', "write a note in this repo, and an agent runs it"))
  out(row("kandy", "the board, in this terminal"))
  out(row("kandy open", "the board, in a browser"))

  out(head("work"))
  out(row("kandy new <text>", "write a note without running it"))
  out(row("kandy ls [--all]", "what's open here"))
  out(row("kandy log", "what's happening, live"))
  out(row("kandy stats", "what this board has done"))

  out(head("team"))
  out(row("kandy join <hub-url>", "put this machine on a team"))
  out(row("kandy invite <email>", "add someone, and get the message to send them"))
  out(row("kandy hub --tailscale", "start a team's board"))

  out(head("what agents can reach"))
  out(row("kandy skills", "skills in this repo, and which runs can see them"))
  out(row("kandy mcp", "MCP servers every agent on this board gets"))

  out(head("this machine"))
  out(row("kandy status", "daemon or team, repos, agents"))
  out(row("kandy stop", "stop kandy here; any command starts it again"))
  out(row("kandy setup", "the first-run questions, again"))
  out(row("kandy gc", "reclaim disk from finished notes"))

  out()
  out(`  ${dim("more")}   ${bold("kandy help")} ${faint("teams · capabilities · board · flags")}`)
  out(`         ${bold("kandy <command> --help")}`)
  out()
  return 0
}

// ── topics ────────────────────────────────────────────────────────────────

async function printTopic(topic: string): Promise<number> {
  const key = topic.toLowerCase()
  const t = TOPICS[key]
  if (t) {
    await t()
    return 0
  }
  if (COMMANDS[key]) return printCommand(key)
  out(lemon(`  no help for "${topic}"`) + dim(`  — try: ${Object.keys(TOPICS).join(", ")}, or a command name`))
  return 1
}

const TOPICS: Record<string, () => void | Promise<void>> = {
  teams() {
    out(head("teams"))
    out(`  ${faint("A hub is the board a team shares. It runs nothing. Everyone's notes run on their")}`)
    out(`  ${faint("own machine, with their own agents and logins, through a runner kandy keeps up.")}`)
    out(head("owner"))
    out(row("kandy hub --tailscale", "start it on any machine on your tailnet"))
    out(`    ${faint("open its url — the first person in owns it — then add people:")}`)
    out(row("kandy invite <email>", "--role member (default) | viewer | owner"))
    out(head("everyone else"))
    out(row("kandy join <hub-url>", "checks you can reach it, who you are, your agents, your"))
    out(`    ${" ".repeat(W)}${faint("clones — then starts your runner. That's all.")}`)
    out(row("kandy consent [nobody|approved|team]", "who may run notes on this machine"))
    out(row("kandy leave", "back to just this machine"))
    out(row("KANDY_LOCAL=1 kandy …", "your own board, while on a team"))
    out(head("who decides"))
    out(`    ${faint("who can open the board        the tailnet, then the hub's members")}`)
    out(`    ${faint("who may run code on my laptop  me — nobody's notes run here until I say yes")}`)
    out(`    ${faint("my agent's permission prompts  me only, never a hub owner")}`)
    out()
  },

  capabilities() {
    out(head("skills"))
    out(`  ${faint("Live in the repo (.agents/skills). A note runs in a checkout of git, so an")}`)
    out(`  ${faint("uncommitted skill reaches no agent kandy starts.")}`)
    out(row("kandy skills", "list them, and flag the uncommitted ones"))
    out(row("kandy skills add <owner/repo>", "install for every agent"))
    out(row("kandy skills commit", "commit the ones no run can see yet"))
    out(head("mcp servers"))
    out(`  ${faint("Set once on the board; every agent gets them in its own format, each run.")}`)
    out(row("kandy mcp add <name> -- <cmd…>", "a local server"))
    out(row("kandy mcp add <name> --url <u>", 'a remote one; --header "K: V"'))
    out(row("kandy mcp rm <name>", ""))
    out(`\n  ${faint("Write secrets as ${NAME}. Each machine fills them from its own environment;")}`)
    out(`  ${faint("the board never holds a token.")}`)
    out()
  },

  async board() {
    const { helpSections } = await import("../tui/keys.js")
    out(head("the board — run kandy in a terminal"))
    for (const s of helpSections()) {
      out(`\n  ${dim(s.title)}`)
      for (const k of s.keys) out(`    ${bold(k.key.padEnd(14))}${faint(k.label)}`)
    }
    out()
  },

  flags() {
    out(head("flags"))
    out(row("--agent claude|codex|cursor|…", "which agent runs a note"))
    out(row("--no-run", "write the note without starting it"))
    out(row("--port N", "a daemon on another port (default 4477)"))
    out(row("--all", "include finished notes in ls"))
    out(row("--verbose", "include agent chatter in log"))
    out(row("--json", "machine-readable output (status, stats, serve)"))
    out(row("--dry-run / --force", "what gc would do / let it remove more"))
    out(row("--slots N", "how many agents may run at once"))
    out()
  },
}

// ── per command ───────────────────────────────────────────────────────────

type CommandHelp = { usage: string; does: string[]; examples?: string[] }

const COMMANDS: Record<string, CommandHelp> = {
  new: {
    usage: "kandy new <text> [--agent a]",
    does: [
      "Write a note on this repo's board without running it. The first line is its title;",
      "the rest is detail, and both go to the agent — put constraints and how to verify there.",
    ],
    examples: ['kandy new "Add a --json flag to serve\nPrint port and db path as JSON."'],
  },
  ls: { usage: "kandy ls [--all]", does: ["What's open on this repo's board. --all includes finished notes."] },
  log: { usage: "kandy log [--verbose]", does: ["Tail what the board is doing, live. --verbose includes agent chatter."] },
  stats: { usage: "kandy stats [--json]", does: ["What this board has done: runs, cost, time, what landed."] },
  open: { usage: "kandy open", does: ["Open the board in a browser — the team hub's, if this machine joined one."] },
  status: { usage: "kandy status [--json]", does: ["Daemon or team, repos, and which agents are signed in here."] },
  join: {
    usage: "kandy join <hub-url> [--repo path] [--token t]",
    does: [
      "Put this machine on a team. Checks the hub is reachable, who it thinks you are, that",
      "you've been added, which agents are signed in, and which of the team's repos you have —",
      "then starts your runner in the background. After this every kandy command uses the hub.",
    ],
    examples: ["kandy join https://kandy-hub.your-tailnet.ts.net"],
  },
  invite: {
    usage: "kandy invite <email> [--role member|viewer|owner]",
    does: ["Add someone to your team's hub, and print the message to send them. Owners only."],
  },
  leave: { usage: "kandy leave", does: ["Take this machine off its team: stops the runner, forgets the hub."] },
  consent: {
    usage: "kandy consent [nobody|approved|team]  ·  kandy consent revoke|approve <email>",
    does: [
      "Who may run notes on this machine besides you. approved (the default): people you've",
      "said yes to — anyone else's note waits for you. Kept on this machine, never on the hub.",
    ],
  },
  hub: {
    usage: "kandy hub --tailscale [--port N]",
    does: [
      "Start a team's board on this machine. It runs no agents and holds no keys. With",
      "--tailscale it serves itself on your tailnet and knows people by their login.",
      "See also: docker compose up (compose.yaml), and kandy help teams.",
    ],
  },
  runner: {
    usage: "kandy runner [--hub url] [--repo path]",
    does: ["Run the notes given to this machine. kandy join starts one for you; this is the same, in the foreground."],
  },
  skills: {
    usage: "kandy skills [add <owner/repo> [--skill s] | remove <name> | commit]",
    does: ["Skills in this repo, which runs can see them, and installing more. kandy help capabilities."],
  },
  mcp: {
    usage: "kandy mcp [add <name> -- <cmd…> | add <name> --url u [--header 'K: V'] | rm <name>]",
    does: ["MCP servers every agent on this board gets, each in its own format. kandy help capabilities."],
  },
  gc: {
    usage: "kandy gc [--dry-run] [--force]",
    does: [
      "Reclaim disk held by notes' checkouts. Finished notes lose theirs; notes in review keep",
      "theirs but lose node_modules and caches. Running notes and every branch are never touched.",
    ],
  },
  serve: { usage: "kandy serve [--port N] [--slots N] [--json]", does: ["Run this machine's daemon in the foreground. Other commands start it for you."] },
  stop: {
    usage: "kandy stop [--port N]",
    does: [
      "Stop this machine's kandy. Notes that were running show as interrupted, and Resume",
      "carries on where they stopped. Any kandy command starts it again.",
    ],
  },
  setup: { usage: "kandy setup", does: ["Ask the first-run question again: just me, join a team, or start a hub."] },
}

export function hasCommandHelp(cmd: string): boolean {
  return cmd in COMMANDS
}

export function printCommand(cmd: string): number {
  const c = COMMANDS[cmd]
  if (!c) return 1
  out()
  out(`  ${bold(c.usage)}`)
  out()
  for (const line of c.does) out(`  ${faint(line)}`)
  if (c.examples?.length) {
    out()
    for (const e of c.examples) for (const line of e.split("\n")) out(`    ${dim(line)}`)
  }
  out()
  return 0
}
