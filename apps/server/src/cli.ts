#!/usr/bin/env node
import type { AgentId } from "@kandy/core"
import { Engine } from "./engine.js"
import { PrWatch } from "./prwatch.js"
import { Runner } from "./runner.js"
import { createHttpServer, parseHosts } from "./http.js"
import { cmdMcp, cmdSkills } from "./cli/capabilities.js"
import { runHub, runRunner } from "./cli/roles.js"
import { joinedHub } from "./joined.js"
import { cmdConsent, cmdInvite, cmdJoin, cmdLeave } from "./cli/join.js"
import { hasCommandHelp, printCommand, printHelp } from "./cli/help.js"
import { needsSetup, runSetup } from "./cli/setup.js"
import { LocalLog } from "./local-log.js"
import { LocalWorkshop } from "./local-workshop.js"
import { ASK_TIMEOUT_MS, Permissions } from "./permission.js"
import { loadToken } from "./auth.js"
import { kandyVersion } from "./version.js"
import { DB_PATH, TOKEN_PATH } from "./paths.js"
import { portOwner } from "./port.js"
import { hasWebBuild } from "./static.js"
import { warmPrices } from "./pricing.js"
import { banner, berry, bold, dim, faint, lemon, mint } from "./cli/banner.js"
import {
  cmdGc,
  cmdList,
  cmdNew,
  cmdOpen,
  adoptHere,
  boardHere,
  cmdSkillInstall,
  cmdStats,
  cmdStatus,
} from "./cli/commands.js"
import { cmdLog } from "./cli/log.js"
import { client, DEFAULT_PORT, ensureUp, hubFor } from "./cli/daemon.js"

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

/** Every value of a flag that may be given more than once: `--header A --header B`. */
function allFlags(args: string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1] !== undefined) out.push(args[++i]!)
  return out
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



/**
 * `kandy stop` — stop this machine's daemon.
 *
 * Every other command starts it, so restarting kandy is "stop, then carry on";
 * without this, it meant finding a process id by hand. Only ever stops kandy:
 * whatever else might hold the port is left alone.
 */
async function stop(port: number): Promise<number> {
  const owner = await portOwner(port)
  if (!owner) {
    process.stdout.write(`  ${dim(`kandy isn't running on :${port}`)}\n`)
    return 0
  }
  if (!owner.kandy) {
    process.stdout.write(`  ${lemon(`port ${port} is held by something that is not kandy`)} ${dim("— leaving it alone")}\n`)
    return 1
  }
  try {
    process.kill(owner.pid, "SIGTERM")
  } catch {
    // Gone between the question and the signal: that is what was wanted.
  }
  for (let i = 0; i < 40; i++) {
    if (!(await portOwner(port))) break
    await new Promise((r) => setTimeout(r, 250))
  }
  process.stdout.write(
    `  ${mint("stopped")} ${dim(`kandy on :${port} (pid ${owner.pid})`)}\n` +
      `  ${faint("Notes that were running show as interrupted — Resume carries on where they stopped.")}\n` +
      `  ${faint("Any kandy command starts it again.")}\n`,
  )
  return 0
}

async function serve(args: string[]): Promise<void> {
  const port = intFlag(args, "--port", DEFAULT_PORT)
  const slots = intFlag(args, "--slots", DEFAULT_SLOTS)
  const json = args.includes("--json")

  const owner = await portOwner(port)
  if (owner?.kandy) {
    const url = `http://127.0.0.1:${port}`
    if (json) {
      process.stdout.write(JSON.stringify({ url, port, pid: owner.pid, alreadyRunning: true }) + "\n")
    } else {
      process.stdout.write(
        `\n  ${mint("kandy is already running")}\n` +
          `  ${faint("at")}     ${dim(url)}\n` +
          `  ${faint("pid")}    ${dim(String(owner.pid))}\n\n` +
          `  ${faint("open it with")} ${dim("kandy open")}${faint(", or stop that one first.")}\n\n`,
      )
    }
    return
  }
  if (owner && !owner.kandy) {
    process.stderr.write(
      `\n  ${lemon("port " + port + " is taken")} ${dim("by something that is not kandy")}\n` +
        `  ${faint("try")}  ${dim("kandy serve --port " + (port + 1))}\n\n`,
    )
    process.exit(1)
  }

  const token = loadToken(TOKEN_PATH)
  const engine = new Engine()
  const prs: PrWatch = new PrWatch(
    { view: (id) => engine.view(id), boards: () => engine.projections.boards(), emit: (p) => void engine.emit(p) }, 60_000, (boardId, noteId) => {
    runner.landed(boardId, noteId)
  })
  // The broker asks the runner where a run lives; the runner hands the broker
  // back so it can settle questions when a run ends. Each references the other,
  // so both are annotated explicitly — inference cannot untangle a cycle and
  // silently falls back to `any` (TS7022/TS7024). Same reason `prs` above is
  // annotated. Neither callback fires until an agent is actually running, so
  // the temporal dead zone is not a problem at runtime.
  const permissions: Permissions = new Permissions(
    engine,
    (runId: string): { boardId: string; noteId: string } | null => runner.locate(runId),
  )
  const runner: Runner = new Runner(
    // `kandy serve` is both halves in one process, so the log is right here.
    // It still goes through the interface a remote runner will use, rather
    // than keeping a shortcut that would let the two drift apart.
    new LocalLog(engine),
    slots,
    (boardId, noteId) => {
      void prs.refresh(boardId, noteId).catch(() => {})
    },
    { url: `http://127.0.0.1:${port}`, token, abandon: (runId) => permissions.abandon(runId) },
  )

  prs.start()
  // Fetched once a day and cached; failing is silent, since pricing a turn
  // must never be able to stop an agent from running.
  void warmPrices()
  const server = createHttpServer({
    engine,
    // The other half of the same seam: what the API asks of the machine with
    // the repositories, answered by the runner right here in this process.
    workshop: new LocalWorkshop(runner),
    prs,
    token,
    permissions,
    hosts: parseHosts(process.env["KANDY_HOSTS"]),
  })
  // A permission prompt is held open for as long as the question is on the
  // board, which is minutes. Node's 5-minute default would sever that
  // connection under us and the agent would be told kandy was unreachable —
  // a lie, and one that reads like a bug in the board rather than a timeout.
  server.requestTimeout = ASK_TIMEOUT_MS + 60_000
  // Losing the race for the port must cost nothing. The preflight above catches
  // the ordinary case; this catches the milliseconds between asking and binding.
  server.on("error", (err: NodeJS.ErrnoException) => {
    const why =
      err.code === "EADDRINUSE"
        ? `port ${port} was taken while starting`
        : err.code === "EACCES"
          ? `port ${port} needs privileges kandy does not have`
          : `the daemon could not listen on ${port}`
    process.stderr.write(`\n  ${lemon(why)}\n  ${faint(err.message)}\n\n`)
    engine.close()
    process.exit(1)
  })

  server.listen(port, "127.0.0.1", () => {
    /*
     * A daemon that died mid-run leaves notes claiming to be running. They
     * aren't — fail them loudly rather than show a board that lies.
     *
     * Deliberately after the socket is ours: this writes to a database a live
     * daemon may be using, so it must not run until we know we are the only
     * one.
     */
    for (const b of engine.projections.boards()) {
      const view = engine.view(b.id)
      if (view) runner.reconcile(view)
    }

    // One line of JSON on start, for a supervisor or a script that needs to
    // know where the daemon landed without scraping a banner. The token is
    // deliberately not in it: it is in a 0600 file, and printing it to stdout
    // would put it in every log that captures this process.
    if (json) {
      process.stdout.write(
        JSON.stringify({
          url: `http://127.0.0.1:${port}`,
          port,
          slots,
          db: DB_PATH,
          tokenPath: TOKEN_PATH,
          webBuilt: hasWebBuild(),
          pid: process.pid,
        }) + "\n",
      )
      return
    }
    process.stdout.write(banner(`http://127.0.0.1:${port}`))
    process.stdout.write(
      `  ${faint("state")}  ${dim(DB_PATH)}\n` +
        `  ${faint("slots")}  ${dim(String(slots))}\n` +
        (hasWebBuild() ? "" : `  ${lemon("board not built")} ${dim("— run pnpm build")}\n`) +
        "\n",
    )
  })

  const shutdown = () => {
    if (!json) process.stdout.write(dim("\n  stopping…\n"))
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
  const all = process.argv.slice(2)
  /*
   * Everything after `--` belongs to someone else's command line — an MCP
   * server's `npx -y @scope/server` — where `-y` is an ordinary argument, not
   * a kandy flag to refuse. So flags are read from before it only.
   */
  const dash = all.indexOf("--")
  const argv = dash === -1 ? all : all.slice(0, dash)
  const tail = dash === -1 ? [] : all.slice(dash + 1)
  const port = intFlag(argv, "--port", DEFAULT_PORT)
  const agent = strFlag(argv, "--agent") as AgentId | undefined
  const noRun = argv.includes("--no-run")
  const VALUED = ["--port", "--slots", "--agent", "--skill", "--url", "--header", "--env", "--hub", "--token", "--https-port", "--repo", "--bind", "--role"]
  const BARE = ["--no-run", "--all", "-a", "--verbose", "-v", "--dry-run", "--force", "--json", "--tailscale", "--first-run", "--check"]

  // A flag we do not know is a typo, not a prompt. Silently dropping `-all`
  // and reporting "nothing here" is worse than refusing it.
  // `-help` too: people type it, and refusing it as a typo of `--help` is
  // pedantry at the exact moment someone is asking for help.
  const KNOWN = [...VALUED, ...BARE, "--help", "-h", "-help", "--version", "-V"]

  /*
   * `--version` before anything else, because the first thing anyone is asked
   * in a bug report is which build they are on, and the honest answer has to
   * come from the package that is running rather than from a constant.
   */
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(kandyVersion() + "\n")
    return
  }
  const unknown = argv.find((a) => a.startsWith("-") && !KNOWN.includes(a))
  if (unknown) {
    const guess = KNOWN.find((k) => k.replace(/^-+/, "") === unknown.replace(/^-+/, ""))
    process.stderr.write(
      berry(`  unknown flag ${unknown}`) + (guess ? dim(`  did you mean ${guess}?`) : "") + "\n",
    )
    process.stderr.write(dim("  kandy -h for help\n"))
    process.exit(1)
  }

  const rest = positionals(argv, VALUED, BARE)
  const first = rest[0]

  // `kandy -h`, and `kandy <command> -h` for that command's page.
  if (argv.includes("--help") || argv.includes("-h") || argv.includes("-help")) {
    process.exit(first && hasCommandHelp(first) ? printCommand(first) : await printHelp())
  }

  switch (first) {
    case undefined:
      // First run in a terminal: one question, once. See cli/setup.ts.
      if (needsSetup() && !(await runSetup())) process.exit(0)
      /*
       * Bare `kandy` in a terminal is the board: where most people spend the
       * day, reached in five keystrokes. Piped, scripted or in CI there is no
       * one to press keys, so it is the status it always was.
       */
      if (process.stdin.isTTY && process.stdout.isTTY && !argv.includes("--json")) {
        process.exit(await cmdBoard({ port }))
      }
      process.exit(await cmdStatus({ port }))
      break
    case "board":
    case "tui":
      process.exit(await cmdBoard({ port }))
      break
    case "serve":
      return serve(argv)
    case "join":
      process.exit(
        await cmdJoin(rest[1], {
          ...(strFlag(argv, "--token") ? { token: strFlag(argv, "--token")! } : {}),
          repos: allFlags(argv, "--repo"),
        }),
      )
      break
    case "leave":
      process.exit(await cmdLeave())
      break
    case "invite":
      process.exit(await cmdInvite(rest[1], strFlag(argv, "--role")))
      break
    case "consent":
      process.exit(await cmdConsent(rest.slice(1)))
      break
    case "hub":
      return runHub({
        port,
        tailscale: argv.includes("--tailscale"),
        // For a container whose Tailscale is a sidecar: trust its headers,
        // answer to its name, but leave `serve` to the sidecar.
        identity: process.env["KANDY_IDENTITY"] === "tailscale" ? "tailscale" : null,
        tailnetHost: process.env["KANDY_TAILNET_HOST"] ?? null,
        bind: strFlag(argv, "--bind") ?? process.env["KANDY_BIND"] ?? "127.0.0.1",
        httpsPort: intFlag(argv, "--https-port", 443),
        json: argv.includes("--json"),
      })
    case "runner": {
      // Flags win; otherwise the hub this machine joined.
      const joined = joinedHub()
      const hub = strFlag(argv, "--hub") ?? process.env["KANDY_HUB"] ?? joined?.url
      if (!hub) {
        process.stderr.write(berry("  not on a team yet — kandy join <hub-url>, or kandy runner --hub <url>\n"))
        process.exit(1)
      }
      const repos = allFlags(argv, "--repo")
      return runRunner({
        hub,
        // On one machine the hub's own token; across a tailnet, none —
        // Tailscale says whose machine this is.
        token: strFlag(argv, "--token") ?? process.env["KANDY_HUB_TOKEN"] ?? joined?.token ?? "",
        slots: intFlag(argv, "--slots", 4),
        json: argv.includes("--json"),
        repos: repos.length ? repos : (joined?.repos ?? []),
      })
    }
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
      process.exit(await cmdStats({ port, json: argv.includes("--json") }))
      break
    case "log":
      process.exit(
        await cmdLog({ port, verbose: argv.includes("--verbose") || argv.includes("-v") }),
      )
      break
    case "gc":
      process.exit(
        await cmdGc({
          port,
          dryRun: argv.includes("--dry-run"),
          force: argv.includes("--force"),
        }),
      )
      break
    case "open":
      process.exit(await cmdOpen({ port }))
      break
    case "skill":
      process.exit(await cmdSkillInstall())
      break
    case "skills": {
      const skill = strFlag(argv, "--skill")
      process.exit(await cmdSkills(rest.slice(1), { port, ...(skill ? { skill } : {}) }))
      break
    }
    case "mcp": {
      const url = strFlag(argv, "--url")
      process.exit(
        await cmdMcp(rest.slice(1), {
          port,
          ...(url ? { url } : {}),
          headers: allFlags(argv, "--header"),
          env: allFlags(argv, "--env"),
          tail,
        }),
      )
      break
    }
    case "help":
      process.exit(await printHelp(rest[1]))
      break
    case "stop":
      process.exit(await stop(port))
      break
    case "update": {
      const { cmdUpdate } = await import("./cli/update.js")
      process.exit(await cmdUpdate({ port, check: argv.includes("--check"), force: argv.includes("--force") }))
      break
    }
    case "setup":
      // From the install script: only a machine that hasn't been set up, and
      // no board after — the terminal it runs in is the installer's.
      if (argv.includes("--first-run")) {
        if (needsSetup()) await runSetup({ board: false })
        process.exit(0)
      }
      if (await runSetup()) process.exit(await cmdBoard({ port }))
      process.exit(0)
      break
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

/**
 * The terminal board, on this repository's board if there is one.
 *
 * Loaded only here: the terminal UI brings React and Ink with it, and no
 * other command — least of all a hub — should pay to load them.
 */
async function cmdBoard(opts: { port: number }): Promise<number> {
  if (!(await ensureUp(opts.port))) return 1
  /*
   * Inside a repository with no board, make it one — the same thing
   * `kandy "a task"` does the first time it sees a repo. Opening the board
   * onto "No boards yet" while standing in a perfectly good repository was
   * the first screen a new person saw.
   */
  let here = await boardHere(opts.port).catch(() => null)
  if (!here && (await inRepo())) here = await adoptHere(opts.port).catch(() => null)
  const { runTui } = await import("./tui/index.js")
  await runTui({ client: client(opts.port), boardId: here?.board.id ?? null, hub: hubFor(opts.port) !== null })
  return 0
}

/** Whether the current directory is inside a git repository. */
async function inRepo(): Promise<boolean> {
  const { execFile } = await import("node:child_process")
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], (err, stdout) => resolve(!err && stdout.trim() === "true"))
  })
}
