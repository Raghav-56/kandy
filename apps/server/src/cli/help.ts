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
  out(row("kandy run [words]", "run the newest draft here, or the one that matches"))
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
  out(row("kandy skill", "teach your own agent to queue work on kandy"))

  out(head("this machine"))
  out(row("kandy status", "daemon or team, repos, agents"))
  out(row("kandy stop", "stop kandy here; any command starts it again"))
  out(row("kandy update", "the newest release, in place"))
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
    out(head("notes"))
    out(row("--agent NAME", "which agent runs a note: claude, codex, cursor, opencode, aider"))
    out(row("--no-run", "write the note without starting it"))
    out(row("--", "the rest is the note, even if it starts with -"))
    out(row("--all, -a", "include finished notes in ls"))
    out(row("--verbose, -v", "include agent chatter in log"))
    out(head("this machine"))
    out(row("--port N", "a daemon on another port (default 4477)"))
    out(row("--slots N", "how many agents may run at once, when this command starts kandy"))
    out(row("--json", "machine-readable output (status, stats, serve, hub, runner)"))
    out(row("--dry-run", "what gc would remove, without removing it"))
    out(row("--force", "gc: remove more · update: even with notes running"))
    out(row("--check", "update: only say whether there is a newer release"))
    out(head("teams"))
    out(row("--hub URL", "runner: the hub to run notes for"))
    out(row("--token T", "join, runner: the hub's token, when it has no Tailscale"))
    out(row("--repo PATH", "join, runner: a clone to run notes in (repeatable)"))
    out(row("--role R", "invite: member (default), viewer or owner"))
    out(row("--tailscale", "hub: serve on your tailnet, know people by their login"))
    out(row("--bind ADDR", "hub: the address to listen on (default 127.0.0.1)"))
    out(row("--https-port N", "hub --tailscale: the port to serve on (default 443)"))
    out(head("capabilities"))
    out(row("--skill NAME", "skills add: just this skill from the repo"))
    out(row("--url URL", "mcp add: a remote server"))
    out(row('--header "K: V"', "mcp add --url: a header (repeatable)"))
    out(row("--env K=V", "mcp add: an environment variable (repeatable)"))
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
  run: {
    usage: "kandy run [text-or-id] [--agent a]",
    does: [
      "Run a draft on this repo's board: the newest one, or the one note whose id starts",
      "with, or whose title contains, the words given. Also resumes an interrupted note.",
    ],
    examples: ["kandy run", "kandy run login flash --agent codex"],
  },
  ls: { usage: "kandy ls [--all]", does: ["What's open on this repo's board. --all includes finished notes."] },
  list: { usage: "kandy list [--all]", does: ["The same as kandy ls: what's open on this repo's board. --all includes finished notes."] },
  board: {
    usage: "kandy board [--port N]",
    does: [
      "The board, in this terminal — what plain kandy opens. In a repo with no board yet, it",
      "makes one. kandy help board lists the keys.",
    ],
  },
  tui: { usage: "kandy tui [--port N]", does: ["The same as kandy board: the board, in this terminal. kandy help board lists the keys."] },
  skill: {
    usage: "kandy skill",
    does: [
      "Copy the kandy skill to ~/.claude/skills/kandy, so an agent you talk to in any repo can",
      "queue notes, check on them and review them for you. Run it again after an update to",
      "get the newest version. Not the same as kandy skills, which lists this repo's skills.",
    ],
  },
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
    usage: "kandy hub --tailscale [--port N] [--https-port N] [--bind addr] [--json]",
    does: [
      "Start a team's board on this machine. It runs no agents and holds no keys. With",
      "--tailscale it serves itself on your tailnet and knows people by their login.",
      "--https-port   the port tailscale serves it on (default 443)",
      "--bind         the address it listens on (default 127.0.0.1; KANDY_BIND)",
      "--json         one line of JSON when it's up, for a script",
      "See also: docker compose up (compose.yaml), and kandy help teams.",
    ],
  },
  runner: {
    usage: "kandy runner [--hub url] [--token t] [--repo path] [--slots N] [--json]",
    does: [
      "Run the notes given to this machine. kandy join starts one for you; this is the same, in the foreground.",
      "--hub     the hub (default: the one you joined; KANDY_HUB)",
      "--token   the hub's token, for a hub without Tailscale (KANDY_HUB_TOKEN)",
      "--repo    a clone to run notes in; repeat it for more",
      "--slots   how many agents may run at once (default 4)",
      "--json    one line of JSON once it's connected, and no status lines",
    ],
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
  update: {
    usage: "kandy update [--check] [--force]",
    does: [
      "Install the newest release over this one. The running kandy is stopped first, and",
      "notes it's running show as interrupted — so with notes running it asks, and without",
      "a terminal to ask in it needs --force. Your team runner is started again after.",
      "--check only says whether there is a newer one: exit 0 up to date, 10 newer one out,",
      "1 couldn't tell.",
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
  setup: {
    usage: "kandy setup [--first-run]",
    does: [
      "Ask the first-run questions again: just me, join a team, or start a hub — and what agents may do.",
      "--first-run asks only on a machine that hasn't been set up (the install script uses it).",
    ],
  },
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
