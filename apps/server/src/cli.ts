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
import { cmdList, cmdNew, cmdOpen, cmdStatus } from "./cli/commands.js"
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
  process.stdout.write(banner())
  const row = (cmd: string, desc: string) => `  ${bold(cmd.padEnd(30))} ${faint(desc)}\n`
  process.stdout.write(
    row('kandy "fix the login flash"', "write a note here and run it") +
      row("kandy new <text>", "write a note without running it") +
      row('  "task" $\'\\n\'"detail"', "first line names it, the rest is detail") +
      row("kandy ls [--all]", "what's on the board for this repo") +
      row("kandy status", "daemon, repos and agents") +
      row("kandy open", "open the board in a browser") +
      row("kandy serve [--port N]", "run the daemon in the foreground") +
      "\n" +
      `  ${faint("flags")}  ${dim("--agent claude|codex   --no-run   --port N")}\n\n`,
  )
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
    case "open":
      process.exit(await cmdOpen({ port }))
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
