#!/usr/bin/env node
import type { AgentId } from "@kandy/core"
import { Engine } from "./engine.js"
import { PrWatch } from "./prwatch.js"
import { Runner } from "./runner.js"
import { createHttpServer } from "./http.js"
import { DB_PATH } from "./paths.js"
import { hasWebBuild } from "./static.js"
import { warmPrices } from "./pricing.js"
import { banner, berry, bold, dim, faint, lemon, mint } from "./cli/banner.js"
import {
  cmdList,
  cmdNew,
  cmdOpen,
  cmdSkillInstall,
  cmdStats,
  cmdStatus,
} from "./cli/commands.js"
import { DEFAULT_PORT } from "./cli/daemon.js"

const DEFAULT_SLOTS = 4

function intFlag(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag)
  if (i === -1) return fallback
  const raw = args[i + 1]
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < 1) {
    console.error(`${flag} expects a positive integer, got: ${raw ?? "(nothing)"}`)
    process.exit(1)
  }
  return n
}

function strFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

/** Positional words, with `--flag value` pairs and bare flags removed. */
function positionals(args: string[], valued: string[], bare: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (valued.includes(a)) {
      i++
      continue
    }
    if (bare.includes(a)) continue
    out.push(a)
  }
  return out
}

function usage(): void {
  const w = process.stdout.write.bind(process.stdout)
  // Pad, but never let a long command swallow its own description.
  const cmd = (c: string, desc: string) =>
    c.length >= 32 ? `  ${bold(c)}\n  ${" ".repeat(32)}${faint(desc)}\n` : `  ${bold(c.padEnd(32))}${faint(desc)}\n`
  const head = (t: string) => `\n  ${dim(t.toUpperCase())}\n`

  w(banner())

  w(`  ${faint("One note is one job. It runs in its own git worktree, on its own")}\n`)
  w(`  ${faint("branch, and comes back as a diff you can read.")}\n`)

  w(head("start here"))
  w(cmd('kandy "fix the login flash"', "write a note here and run it"))
  w(`  ${dim("Run it from inside a repository. kandy adopts the repo the first")}\n`)
  w(`  ${dim("time it sees one, and starts its own daemon if it is not running.")}\n`)

  w(head("writing"))
  w(cmd("kandy <text>", "write a note and run it"))
  w(cmd("kandy new <text>", "write it, don't run it"))
  w(`\n  ${dim("The first line names the note; the rest is detail. Both are given")}\n`)
  w(`  ${dim("to the agent, so put constraints and how to verify in the detail:")}\n\n`)
  w(`  ${faint('kandy "Add a --json flag to kandy serve')}\n`)
  w(`  ${faint("Print port, db path and slot count as JSON.")}\n`)
  w(`  ${faint('Verify with: pnpm build && kandy serve --json"')}\n`)

  w(head("looking"))
  w(cmd("kandy", "status: daemon, repos, agents"))
  w(cmd("kandy ls [--all]", "what's open here; --all includes done"))
  w(cmd("kandy stats", "what this board has actually done"))
  w(cmd("kandy open", "the board in a browser"))

  w(head("setup"))
  w(cmd("kandy serve [--port N]", "run the daemon in the foreground"))
  w(cmd("kandy skill", "let other agents queue work onto a board"))

  w(head("flags"))
  w(cmd("--agent claude|codex", "which agent runs it"))
  w(cmd("--no-run", "write the note without starting it"))
  w(cmd("--port N", "a daemon on a different port (default 4477)"))
  w(cmd("--all", "include finished notes in `ls`"))
  w(cmd("--slots N", "how many agents may run at once (serve)"))

  w(`\n  ${dim("Notes run with repo-only permissions by default: an agent can edit")}\n`)
  w(`  ${dim("files but most shell commands are refused. Change that per note on")}\n`)
  w(`  ${dim("the board — a worktree bounds what it can damage inside the repo,")}\n`)
  w(`  ${dim("not what it can reach outside one.")}\n`)

  w(`\n  ${faint("docs")}  ${dim("https://github.com/hiteshbandhu/kandy")}\n\n`)
}

function serve(args: string[]): void {
  const port = intFlag(args, "--port", DEFAULT_PORT)
  const slots = intFlag(args, "--slots", DEFAULT_SLOTS)

  const engine = new Engine()
  const prs: PrWatch = new PrWatch(engine, 60_000, (boardId, noteId) => {
    runner.landed(boardId, noteId)
  })
  const runner = new Runner(engine, slots, (boardId, noteId) => {
    void prs.refresh(boardId, noteId).catch(() => {})
  })

  // A daemon that died mid-run leaves notes claiming to be running. They
  // aren't. Fail them loudly rather than showing a board that lies.
  for (const b of engine.projections.boards()) {
    const view = engine.view(b.id)
    if (view) runner.reconcile(view)
  }

  prs.start()
  // Fetched once a day and cached; failing is silent, since pricing a turn
  // must never be able to stop an agent from running.
  void warmPrices()
  const server = createHttpServer({ engine, runner, prs })
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(banner(`http://127.0.0.1:${port}`))
    process.stdout.write(
      `  ${faint("state")}  ${dim(DB_PATH)}\n` +
        `  ${faint("slots")}  ${dim(String(slots))}\n` +
        (hasWebBuild() ? "" : `  ${lemon("board not built")} ${dim("— run pnpm build")}\n`) +
        "\n",
    )
  })

  const shutdown = () => {
    process.stdout.write(dim("\n  stopping…\n"))
    runner.shutdown()
    prs.stop()
    server.close()
    engine.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const port = intFlag(argv, "--port", DEFAULT_PORT)
  const agent = strFlag(argv, "--agent") as AgentId | undefined
  const noRun = argv.includes("--no-run")
  const VALUED = ["--port", "--slots", "--agent"]
  const BARE = ["--no-run", "--all", "-a"]

  // A flag we do not know is a typo, not a prompt. Silently dropping `-all`
  // and reporting "nothing here" is worse than refusing it.
  const KNOWN = [...VALUED, ...BARE, "--help", "-h"]
  const unknown = argv.find((a) => a.startsWith("-") && !KNOWN.includes(a))
  if (unknown) {
    const guess = KNOWN.find((k) => k.replace(/^-+/, "") === unknown.replace(/^-+/, ""))
    process.stderr.write(
      berry(`  unknown flag ${unknown}`) + (guess ? dim(`  did you mean ${guess}?`) : "") + "\n",
    )
    usage()
    process.exit(1)
  }

  const rest = positionals(argv, VALUED, BARE)
  const first = rest[0]

  if (argv.includes("--help") || argv.includes("-h")) return usage()

  switch (first) {
    case undefined:
      process.exit(await cmdStatus({ port }))
      break
    case "serve":
      return serve(argv)
    case "new":
      process.exit(await cmdNew(rest.slice(1), { port, agent, run: false }))
      break
    case "ls":
    case "list":
      process.exit(await cmdList({ port, all: argv.includes("--all") || argv.includes("-a") }))
      break
    case "status":
      process.exit(await cmdStatus({ port }))
      break
    case "stats":
      process.exit(await cmdStats({ port }))
      break
    case "open":
      process.exit(await cmdOpen({ port }))
      break
    case "skill":
      process.exit(await cmdSkillInstall())
      break
    case "help":
      return usage()
    default: {
      // Anything else is the shorthand: `kandy "do the thing"` writes a note
      // here and runs it. This is the path that should feel like nothing.
      process.exit(await cmdNew(rest, { port, agent, run: !noRun }))
    }
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(berry(`  ${err instanceof Error ? err.message : String(err)}\n`))
  process.exit(1)
})
