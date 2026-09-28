import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { KandyClient } from "@kandy/client"
import { INSTALL_URL, RELEASES_LATEST } from "@kandy/core"
import { readToken } from "../auth.js"
import { joinedHub, RUNNER_LOG, runnerPid } from "../joined.js"
import { STATE_DIR, TOKEN_PATH } from "../paths.js"
import { portOwner } from "../port.js"
import { kandyVersion } from "../version.js"
import { bold, dim, faint, lemon, mint } from "./banner.js"
import { choose } from "./choose.js"

const out = (s = "") => process.stdout.write(s + "\n")

/**
 * What `kandy update --check` exits with when there is a newer release, so a
 * script can tell "newer one out" from "up to date" (0) and "couldn't tell" (1).
 */
export const UPDATE_AVAILABLE = 10

/**
 * `kandy update`: the newest release, in place.
 *
 * The same install the one-line script does — `npm i -g` of the release
 * tarball — after asking GitHub what the newest release is, so being up to
 * date costs one request and no reinstall.
 *
 * Whatever is running is stopped first, so the next command starts the new
 * version rather than talking to the old one. Stopping it interrupts the
 * notes it is running, so when there are any it says which and asks first.
 */
export async function cmdUpdate(opts: { port: number; check: boolean; force?: boolean }): Promise<number> {
  const current = kandyVersion()
  await warnStaleDaemon(opts.port, current)

  const latest = await latestVersion()
  if (!latest) {
    out(`  ${lemon("couldn't reach GitHub to see what's newest")} ${dim(`— you're on ${current}`)}`)
    out(faint(`  Update by hand: npm i -g ${INSTALL_URL}`))
    return 1
  }

  if (compareVersions(latest, current) <= 0) {
    out(`  ${mint("up to date")} ${dim(`— kandy ${current} is the newest release`)}`)
    return 0
  }
  out(`  ${bold(`kandy ${latest}`)} ${dim(`is out — you're on ${current}`)}`)
  if (opts.check) {
    out(faint("  kandy update installs it."))
    return UPDATE_AVAILABLE
  }

  // A source checkout is somebody's work in progress; installing over it
  // from npm would leave two kandys on PATH and the wrong one first.
  const checkout = sourceCheckout()
  if (checkout) {
    out(`  ${lemon("this kandy runs from a source checkout")} ${dim(checkout)}`)
    out(faint("  Update it there: git pull && pnpm install && pnpm build"))
    return 1
  }

  const running = await whatsRunning(opts.port)
  if (!(await confirmInterrupt(running, !!opts.force))) return 1

  await stopRunning(running)
  const npm = npmCommand(process.execPath, process.platform, existsSync)
  out(dim(`  installing ${latest}…`))
  const code = await runNpm(npm, ["install", "-g", "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=error", INSTALL_URL])
  const stopped = running.daemon !== null || running.runner !== null

  if (code !== 0) {
    out(`  ${lemon("npm couldn't install it")} ${dim(`— see above; kandy ${current} is still what's installed`)}`)
    if (stopped) out(faint("  It was stopped for the update. Any kandy command starts it again."))
    // The old files are still in place: put the runner back as it was.
    if (running.runner !== null) restartRunner(here("../bin.js"))
    out(faint("  Permission denied? https://hiteshbandhu.github.io/kandy/guide/troubleshooting#the-install-fails-with-eacces-permission-denied"))
    return 1
  }

  // npm says it worked; check the new files are what was asked for, and that
  // `kandy` on PATH is them — a second install earlier on PATH (another Node
  // manager, a Homebrew kandy) would keep running the old one.
  const root = npmRoot(npm)
  const installed = root ? packageVersion(path.join(root, "kandy", "package.json")) : null
  if (installed && installed !== latest) {
    out(`  ${lemon(`npm finished, but kandy ${installed} is what's installed`)} ${dim(`— expected ${latest}`)}`)
    out(faint(`  Try it by hand: npm i -g ${INSTALL_URL}`))
    return 1
  }

  if (running.runner !== null) {
    const entry = root ? path.join(root, "kandy", "dist", "bin.js") : here("../bin.js")
    restartRunner(existsSync(entry) ? entry : here("../bin.js"))
    out(dim("  started your team runner again"))
  }

  out(`  ${mint("updated")} ${bold(`${current} → ${latest}`)}`)
  const onPath = pathVersion()
  if (onPath !== latest) {
    const where = findOnPath("kandy")
    out(
      `  ${lemon(onPath ? `but kandy on your PATH is still ${onPath}` : "but kandy isn't on your PATH")}` +
        (where ? dim(` — ${where}`) : ""),
    )
    if (root) out(faint(`  The new one is in ${root}. Put its bin folder first on PATH, or remove the other kandy.`))
    return 1
  }
  if (running.daemon !== null) out(faint("  Any kandy command starts the new version."))
  out(faint("  What changed: https://hiteshbandhu.github.io/kandy/changelog"))
  return 0
}

/**
 * The newest release's version, from where `releases/latest` redirects —
 * `…/releases/tag/v0.2.0-alpha.7`. A redirect rather than GitHub's API, which
 * allows sixty unauthenticated requests an hour per address.
 */
export async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_LATEST, { redirect: "manual", signal: AbortSignal.timeout(10_000) })
    return versionFromTagUrl(res.headers.get("location") ?? "")
  } catch {
    return null
  }
}

export function versionFromTagUrl(url: string): string | null {
  const m = /\/releases\/tag\/v?([^/?#]+)$/.exec(url)
  return m ? decodeURIComponent(m[1]!) : null
}

/**
 * Semver order, prereleases included: 0.2.0-alpha.10 is after alpha.9, and a
 * release is after any of its prereleases. Negative, zero or positive.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main = "", pre] = v.replace(/^v/, "").split("-", 2) as [string, string | undefined]
    return { nums: main.split(".").map((n) => Number(n) || 0), pre: pre ? pre.split(".") : [] }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0)
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const d = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q)
    if (d !== 0) return d
  }
  return 0
}

/**
 * The npm that belongs to the Node running this, when it sits beside it.
 *
 * `npm` on PATH may be another Node's — nvm, fnm, Homebrew and a system Node
 * side by side — and would install kandy somewhere this Node never looks.
 * Run as `node npm-cli.js` so Windows needs no shell. Volta is the exception:
 * its npm on PATH is a shim that installs where Volta's own bin can see it.
 */
export function npmCommand(
  execPath: string,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean,
  env: NodeJS.ProcessEnv = process.env,
): { cmd: string; args: string[]; shell: boolean } {
  const p = platform === "win32" ? path.win32 : path.posix
  const dir = p.dirname(execPath)
  const volta = env["VOLTA_HOME"] && execPath.startsWith(env["VOLTA_HOME"])
  if (!volta) {
    const cli =
      platform === "win32"
        ? p.join(dir, "node_modules", "npm", "bin", "npm-cli.js")
        : p.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
    if (exists(cli)) return { cmd: execPath, args: [cli], shell: false }
  }
  // npm is npm.cmd on Windows, which only a shell can run.
  return { cmd: "npm", args: [], shell: platform === "win32" }
}

type Npm = ReturnType<typeof npmCommand>

function runNpm(npm: Npm, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(npm.cmd, [...npm.args, ...args], { stdio: "inherit", shell: npm.shell })
    child.on("error", () => resolve(1))
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

/** Where `npm i -g` puts packages, for this npm. */
function npmRoot(npm: Npm): string | null {
  const r = spawnSync(npm.cmd, [...npm.args, "root", "-g"], { encoding: "utf8", shell: npm.shell })
  const dir = r.status === 0 ? r.stdout.trim() : ""
  return dir || null
}

function packageVersion(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

/** What `kandy --version` says for the kandy a new shell would run. */
function pathVersion(): string | null {
  const r = spawnSync("kandy", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 15_000,
  })
  const v = r.status === 0 ? r.stdout.trim().split(/\s+/).pop() : ""
  return v || null
}

function findOnPath(name: string): string | null {
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".ps1", ""] : [""]
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const f = path.join(dir, name + ext)
      if (dir && existsSync(f)) return f
    }
  }
  return null
}

function here(rel: string): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel)
}

/** The checkout this CLI runs from, when it isn't an npm install. */
function sourceCheckout(): string | null {
  const file = fileURLToPath(import.meta.url)
  if (file.split(/[\\/]/).includes("node_modules")) return null
  // …/apps/server/dist/cli/update.js → the repository.
  return file.replace(/[\\/]apps[\\/]server[\\/]dist[\\/].*$/, "")
}

/**
 * A daemon started before an update keeps running the old code until it is
 * stopped. Said here, where someone checking their version will look.
 */
async function warnStaleDaemon(port: number, current: string): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    const body = (await res.json()) as { version?: string }
    if (body.version && body.version !== current) {
      out(`  ${lemon(`the kandy running on :${port} is ${body.version}`)} ${dim(`— this command is ${current}`)}`)
      out(faint("  kandy stop, and the next command starts this version."))
    }
  } catch {
    // Nothing running, or not kandy: nothing to compare.
  }
}

type Running = {
  daemon: number | null
  runner: number | null
  /** Titles of the notes stopping would interrupt, or null when they couldn't be read. */
  notes: string[] | null
}

/** This machine's daemon and team runner, and the notes they're running. */
async function whatsRunning(port: number): Promise<Running> {
  const owner = await portOwner(port)
  const daemon = owner?.kandy ? owner.pid : null
  const runner = runnerPid()
  if (daemon === null && runner === null) return { daemon, runner, notes: [] }

  const notes: string[] = []
  try {
    if (daemon !== null) {
      const api = new KandyClient({ baseUrl: `http://127.0.0.1:${port}`, token: () => readToken(TOKEN_PATH) })
      notes.push(...(await runningTitles(api, () => true)))
    }
    const hub = joinedHub()
    if (runner !== null && hub) {
      // Only this machine's part of the team's board: the runner is what stops.
      const me = runnerIdHere()
      const api = new KandyClient({ baseUrl: hub.url, token: () => hub.token })
      notes.push(...(await runningTitles(api, (n) => me !== null && n.runner === me)))
    }
    return { daemon, runner, notes }
  } catch {
    return { daemon, runner, notes: null }
  }
}

async function runningTitles(
  api: KandyClient,
  keep: (n: { runner?: string | null }) => boolean,
): Promise<string[]> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000).unref())
  const read = async () => {
    const titles: string[] = []
    const { boards } = await api.boards()
    for (const b of boards) {
      const view = await api.view(b.id)
      for (const n of view.notes) if (n.status === "running" && keep(n)) titles.push(n.title)
    }
    return titles
  }
  return Promise.race([read(), timeout])
}

function runnerIdHere(): string | null {
  try {
    return readFileSync(path.join(STATE_DIR, "runner-id"), "utf8").trim() || null
  } catch {
    return null
  }
}

/**
 * Stopping kandy interrupts what it's running. With notes running, a person
 * at a terminal is asked; a script has to say --force.
 */
async function confirmInterrupt(running: Running, force: boolean): Promise<boolean> {
  if (running.daemon === null && running.runner === null) return true
  const { notes } = running
  if (notes !== null && notes.length === 0) return true

  if (notes === null) {
    out(`  ${lemon("kandy is running here")} ${dim("— couldn't see which notes it's running")}`)
  } else {
    out(`  ${lemon(`${notes.length} note${notes.length === 1 ? " is" : "s are"} running here:`)}`)
    for (const t of notes.slice(0, 8)) out(`    ${dim("·")} ${t}`)
    if (notes.length > 8) out(faint(`    and ${notes.length - 8} more`))
  }
  out(faint("  Updating stops kandy, and they'll show as interrupted. Resume carries on where they stopped."))
  if (force) return true

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    out(faint("  kandy update --force to update anyway, or wait until they finish."))
    return false
  }
  const pick = await choose([{ label: "Not now" }, { label: "Update, and interrupt them" }])
  if (pick !== 1) {
    out(dim("  nothing changed — kandy update again when they're done"))
    return false
  }
  return true
}

/** This machine's kandy and runner, stopped, so nothing keeps the old code. */
async function stopRunning(running: Running): Promise<void> {
  const pids = [running.daemon, running.runner].filter((p): p is number => p !== null)
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  for (let i = 0; i < 40 && pids.some(alive); i++) {
    await new Promise((r) => setTimeout(r, 250))
  }
  if (pids.length) out(dim("  stopped the running kandy"))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The team runner, started again in the background from `entry`. */
function restartRunner(entry: string): void {
  mkdirSync(path.dirname(RUNNER_LOG), { recursive: true })
  const log = openSync(RUNNER_LOG, "a")
  const child = spawn(process.execPath, [entry, "runner", "--json"], {
    detached: true,
    stdio: ["ignore", log, log],
  })
  child.unref()
}
