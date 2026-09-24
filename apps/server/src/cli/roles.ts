import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { hostname, platform } from "node:os"
import path from "node:path"
import { event, id, RUNNER_PROTOCOL, type BoardView, type Hello } from "@kandy/core"
import { loadToken } from "../auth.js"
import { ConsentStore } from "../consent.js"
import { Engine } from "../engine.js"
import { HubLink } from "../hub-link.js"
import { Runners } from "../hub.js"
import { createHttpServer, parseHosts } from "../http.js"
import { tailscaleIdentity } from "../identity.js"
import { Members } from "../members.js"
import { STATE_DIR, TOKEN_PATH } from "../paths.js"
import { Permissions } from "../permission.js"
import type { PrWatch } from "../prwatch.js"
import { RemoteLog } from "../remote-log.js"
import { RemoteWorkshop } from "../remote-workshop.js"
import { explain, serve as tailscaleServe, tailscaleStatus, unserve } from "../tailscale.js"
import { banner, dim, faint, lemon, mint } from "./banner.js"

/**
 * `kandy hub` and `kandy runner` — the two halves of `kandy serve`, apart.
 *
 * `kandy serve` stays exactly what it was: one person, one machine, both
 * halves in one process. These are for when the halves are on different
 * machines — a hub a team shares, and a runner on each person's laptop that
 * runs their notes with their own agents and their own logins.
 */

const out = (s = "") => process.stdout.write(s + "\n")

// ── the hub ───────────────────────────────────────────────────────────────

/**
 * A log, an API and a relay. Never an agent, never a repository.
 *
 * This file imports no runner, no worktree, no agent adapter — the boundary
 * test checks the hub's modules for it — so a hub cannot start an agent even
 * by accident.
 */
export async function runHub(opts: { port: number; tailscale: boolean; httpsPort: number; json: boolean }) {
  const token = loadToken(TOKEN_PATH)
  const engine = new Engine()
  const runners = new Runners(engine)

  const locate = (runId: string) => {
    for (const b of engine.projections.boards()) {
      const run = engine.view(b.id)?.runs.find((r) => r.id === runId)
      if (run) return { boardId: b.id, noteId: run.noteId }
    }
    return null
  }
  const permissions = new Permissions(engine, locate)
  // A runner cannot settle its questions when its run ends — the questions
  // live here. So the hub does, on hearing the run finish.
  engine.bus.subscribe((f) => {
    if (!("kind" in f) && f.type === "run.finished") permissions.abandon(f.data.runId)
  })

  let hosts = parseHosts(process.env["KANDY_HOSTS"])
  let members: Members | undefined
  let reach = `http://127.0.0.1:${opts.port}`

  if (opts.tailscale) {
    const ts = await tailscaleStatus()
    if (!ts.ok) {
      out(lemon(`  ${explain(ts.reason)}`))
      process.exit(1)
    }
    hosts = new Set([...hosts, ts.self.dnsName.toLowerCase()])
    members = new Members(engine)
    reach = `https://${ts.self.dnsName}${opts.httpsPort === 443 ? "" : `:${opts.httpsPort}`}`
  }

  // PR state is read with `gh`, inside a repository, with someone's own
  // credentials — none of which a hub has. On a hub it is not watched; the
  // PR still opens from the runner that holds the branch.
  const prs = { refresh: async () => {}, start() {}, stop() {} } as unknown as PrWatch

  const server = createHttpServer({
    engine,
    workshop: new RemoteWorkshop(engine, runners, null),
    workshopFor: (actor) => new RemoteWorkshop(engine, runners, actor),
    prs,
    token,
    permissions,
    hosts,
    runners,
    ...(members ? { identity: tailscaleIdentity(), members } : {}),
  })
  server.requestTimeout = 0

  // Loopback only, always. With Tailscale in front this is what makes the
  // identity headers trustworthy: nothing but tailscaled can connect here.
  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve))
  if (opts.tailscale) await tailscaleServe(opts.port, opts.httpsPort)

  if (opts.json) {
    out(JSON.stringify({ role: "hub", url: reach, port: opts.port, tailscale: opts.tailscale, pid: process.pid }))
  } else {
    process.stdout.write(banner(reach))
    out(`  ${faint("role")}   ${dim("hub — runs nothing itself; runners connect to it")}`)
    out(`  ${faint("join")}   ${dim(`kandy runner --hub ${reach}${opts.tailscale ? "" : " --token <token>"}`)}`)
    if (opts.tailscale) out(`  ${faint("who")}    ${dim("whoever Tailscale says; the first person to open it owns it")}`)
    out()
  }

  const shutdown = async () => {
    if (opts.tailscale) await unserve(opts.httpsPort)
    server.close()
    engine.close()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

// ── the runner ────────────────────────────────────────────────────────────

/** Stable per machine, so a hub recognises a runner across restarts. */
function runnerId(): string {
  const file = path.join(STATE_DIR, "runner-id")
  try {
    const existing = readFileSync(file, "utf8").trim()
    if (/^[A-Za-z0-9_-]{4,64}$/.test(existing)) return existing
  } catch {
    // First run on this machine.
  }
  const fresh = id("rnr")
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(file, fresh + "\n", { mode: 0o600 })
  return fresh
}

/**
 * Only this runner's part of a board.
 *
 * A runner starting up reconciles what it finds — fails runs that died with
 * it, re-adopts checkouts. On a hub the board holds other people's notes too,
 * running on other people's machines, and failing *their* runs because this
 * one restarted would be exactly the kind of cross-talk the split exists to
 * prevent.
 */
function mine(view: BoardView, me: string): BoardView {
  const notes = view.notes.filter((n) => n.runner === me)
  const ids = new Set(notes.map((n) => n.id))
  return { ...view, notes, runs: view.runs.filter((r) => ids.has(r.noteId)) }
}

export async function runRunner(opts: { hub: string; token: string; slots: number; json: boolean; repos: string[] }) {
  // Imported here, not at the top: a hub process loads this file for `runHub`
  // and must never pull the runner — and with it every agent adapter — in.
  const { Runner } = await import("../runner.js")
  const { LocalWorkshop } = await import("../local-workshop.js")
  const { detectAll } = await import("../agents/index.js")
  const { originOf } = await import("../worktree.js")
  const { repos: nearby } = await import("../browse.js")

  const hub = opts.hub.replace(/\/+$/, "")
  const me = runnerId()
  const headers: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {}
  const consent = new ConsentStore()

  let link: HubLink | undefined
  const log = new RemoteLog(
    (ops) => link!.sendLog(ops),
    (runId) => link!.history(runId),
  )
  const runner = new Runner(log, opts.slots, undefined, { url: hub, token: opts.token })
  const workshop = new LocalWorkshop(runner)

  /*
   * Where this machine keeps each board's repository.
   *
   * By remote, not by path: a path in the log is where the repository is on
   * whoever made the board, and a teammate's clone of it is somewhere else.
   * Clones named with `--repo` come first and, when given, are the only ones
   * this runner serves — that is how a person says "this checkout, not that
   * one". Without them the recorded path is used if it is here and is the
   * same repository, and failing that a clone of it is looked for in the
   * usual places code lives.
   */
  const explicit = await Promise.all(
    // Resolved through symlinks: on macOS /var is /private/var, and a path
    // that differs only by a link is the same checkout.
    opts.repos.map(async (p) => {
      const real = realpathSync(path.resolve(p))
      return { path: real, remote: await originOf(real).catch(() => null) }
    }),
  )
  let found: { path: string; remote: string | null }[] | null = null
  const discover = async () =>
    (found ??= await Promise.all(
      nearby(80).map(async (e) => ({ path: e.path, remote: await originOf(e.path).catch(() => null) })),
    ))
  const where = new Map<string, string>()

  async function locate(): Promise<void> {
    for (const b of log.replica.boards()) {
      if (where.has(b.id)) continue
      const hit =
        explicit.find((r) => (b.remote && r.remote === b.remote) || r.path === b.repoPath)?.path ??
        (explicit.length
          ? null
          : existsSync(path.join(b.repoPath, ".git")) && (!b.remote || (await originOf(b.repoPath)) === b.remote)
            ? b.repoPath
            : b.remote
              ? (await discover()).find((r) => r.remote === b.remote)?.path ?? null
              : null)
      if (hit) where.set(b.id, hit)
    }
  }
  log.localPath = (b) => where.get(b.id) ?? null

  /** Boards whose repository is on this machine. The only ones it can be asked to work on. */
  const boards = () => log.replica.boards().filter((b) => where.has(b.id)).map((b) => b.id)

  let agents = await detectAll()
  const hello = (): Hello => ({
    protocol: RUNNER_PROTOCOL,
    runnerId: me,
    name: hostname(),
    os: platform(),
    agents,
    boards: boards(),
  })

  // Every workshop method is a command the hub may send, plus the two that
  // consent adds. Bound so `this` survives being called by name.
  const handlers: Record<string, (...args: never[]) => Promise<unknown>> = {}
  for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(workshop))) {
    const fn = (workshop as unknown as Record<string, unknown>)[k]
    if (k !== "constructor" && typeof fn === "function") {
      handlers[k] = (fn as (...a: unknown[]) => Promise<unknown>).bind(workshop) as never
    }
  }

  /**
   * Run a note — if its owner would say yes.
   *
   * The hub says who asked; this machine decides whether that is enough.
   * Held means nothing starts: no worktree, no process, no tokens spent.
   * The note shows the request on the board, with the requester's name, for
   * this machine's owner to answer.
   */
  /*
   * Commands from the hub name repositories by the path recorded in the log.
   * Every argument that is one of those paths becomes this machine's own
   * before the workshop sees it.
   */
  const toLocal = (a: unknown) => {
    if (typeof a !== "string") return a
    const b = log.replica.boards().find((x) => x.repoPath === a)
    return b ? (where.get(b.id) ?? a) : a
  }
  for (const [k, fn] of Object.entries(handlers)) {
    handlers[k] = ((...args: unknown[]) => (fn as (...a: unknown[]) => Promise<unknown>)(...args.map(toLocal))) as never
  }

  handlers["request"] = (async (boardId: string, noteId: string, agent: string, requestedBy: string | null) => {
    if (consent.decide(requestedBy, link!.owner) === "hold") {
      log.emit(event("note.held", { noteId, runnerId: me, requestedBy, agent: agent as never }))
      await log.flush()
      return ""
    }
    return workshop.request(boardId, noteId, agent as never)
  }) as never

  handlers["consent"] = (async (
    boardId: string,
    noteId: string,
    accept: boolean,
    always: boolean,
    requestedBy: string | null,
    agent: string,
  ) => {
    if (accept && always && requestedBy) consent.approve(requestedBy)
    log.emit(event("note.released", { noteId, accepted: accept }))
    return accept ? workshop.request(boardId, noteId, agent as never) : ""
  }) as never

  link = new HubLink({
    hub,
    headers,
    hello,
    handlers,
    log,
    onStatus: (s, why) => {
      if (!opts.json) out(s === "online" ? `  ${mint("connected")} ${dim(hub)}` : `  ${lemon("offline")} ${dim(why ?? "")}`)
    },
  })
  void link.start()
  await link.ready

  // Now the replica is true, find this machine's clones and say hello again
  // with the boards they make it able to serve.
  await locate()
  await announce()
  for (const b of log.replica.boards()) {
    const view = log.view(b.id)
    if (view) runner.reconcile(mine(view, me))
  }
  // A board added later, or agents signed into later, should not need a
  // restart. Boards are announced the moment their creation arrives, because
  // a note on a new board cannot run until some runner says it has the repo.
  log.onEvent((e) => {
    if (e.type === "board.created" || e.type === "board.removed") void locate().then(announce)
  })
  const again = setInterval(() => void refresh(), 60_000)

  async function refresh() {
    agents = await detectAll()
    await announce()
  }
  async function announce() {
    await fetch(hub + "/runner/hello", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(hello()),
    }).catch(() => {})
  }

  if (opts.json) out(JSON.stringify({ role: "runner", runnerId: me, hub, owner: link.owner, boards: boards() }))
  else {
    out(`  ${faint("runner")} ${dim(me)} ${faint("on")} ${dim(hostname())}`)
    out(`  ${faint("owner")}  ${dim(link.owner ?? "this machine (single-player hub)")}`)
    out(`  ${faint("boards")} ${dim(String(boards().length))}`)
    out(`  ${faint("accept")} ${dim(consent.get().accept)} ${faint("— who may run notes here besides you")}`)
    out()
  }

  const shutdown = async () => {
    clearInterval(again)
    link?.stop()
    runner.shutdown()
    await log.drain().catch(() => {})
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}
