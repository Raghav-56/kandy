import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { INSTALL_URL, RELEASES_LATEST } from "@kandy/core"
import { runnerPid } from "../joined.js"
import { portOwner } from "../port.js"
import { kandyVersion } from "../version.js"
import { bold, dim, faint, lemon, mint } from "./banner.js"

const out = (s = "") => process.stdout.write(s + "\n")

/**
 * `kandy update`: the newest release, in place.
 *
 * The same install the one-line script does — `npm i -g` of the release
 * tarball — after asking GitHub what the newest release is, so being up to
 * date costs one request and no reinstall. Whatever was running is stopped
 * first, so the next command starts the new version rather than talking to
 * the old one.
 */
export async function cmdUpdate(opts: { port: number; check: boolean }): Promise<number> {
  const current = kandyVersion()
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
    return 0
  }

  // A source checkout is somebody's work in progress; installing over it
  // from npm would leave two kandys on PATH and the wrong one first.
  const checkout = sourceCheckout()
  if (checkout) {
    out(`  ${lemon("this kandy runs from a source checkout")} ${dim(checkout)}`)
    out(faint("  Update it there: git pull && pnpm install && pnpm build"))
    return 1
  }

  await stopRunning(opts.port)
  out(dim(`  installing ${latest}…`))
  const code = await npmInstall()
  if (code !== 0) {
    out(`  ${lemon("npm couldn't install it")} ${dim("— see above; nothing was changed")}`)
    out(faint("  Permission denied? https://hiteshbandhu.github.io/kandy/guide/troubleshooting"))
    return 1
  }
  out(`  ${mint("updated")} ${bold(`${current} → ${latest}`)}`)
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

/** The checkout this CLI runs from, when it isn't an npm install. */
function sourceCheckout(): string | null {
  const here = fileURLToPath(import.meta.url)
  if (here.split(/[\\/]/).includes("node_modules")) return null
  // …/apps/server/dist/cli/update.js → the repository.
  return here.replace(/[\\/]apps[\\/]server[\\/]dist[\\/].*$/, "")
}

/** This machine's kandy and runner, stopped, so nothing keeps the old code. */
async function stopRunning(port: number): Promise<void> {
  const owner = await portOwner(port)
  const pids = [owner?.kandy ? owner.pid : null, runnerPid()].filter((p): p is number => p !== null)
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  if (pids.length) out(dim("  stopped the running kandy — the next command starts the new one"))
  for (let i = 0; i < 40 && owner?.kandy && (await portOwner(port)); i++) {
    await new Promise((r) => setTimeout(r, 250))
  }
}

function npmInstall(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      ["install", "-g", "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=error", INSTALL_URL],
      // npm is npm.cmd on Windows, which only a shell can run.
      { stdio: "inherit", shell: process.platform === "win32" },
    )
    child.on("error", () => resolve(1))
    child.on("exit", (code) => resolve(code ?? 1))
  })
}
