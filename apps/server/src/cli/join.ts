import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { INSTALL_COMMAND, ROLES, type Board, type Role } from "@kandy/core"
import { detectAll } from "../agents/index.js"
import { repos as nearby } from "../browse.js"
import { forgetJoined, joinedHub, RUNNER_LOG, runnerPid, saveJoined } from "../joined.js"
import { explain, tailscaleStatus } from "../tailscale.js"
import { originOf } from "../worktree.js"
import { berry, bold, dim, faint, lemon, mint } from "./banner.js"
import { client, startRunner } from "./daemon.js"
import { readFileSync } from "node:fs"
import { STATE_DIR } from "../paths.js"

const out = (s = "") => process.stdout.write(s + "\n")

/**
 * `kandy join <hub-url>` — put this machine on a team.
 *
 * One command, because onboarding that is a checklist is onboarding people
 * get half-way through. It answers the questions a person would otherwise
 * have to ask in a channel — can I reach it, who does it think I am, am I
 * let in, which of my agents can run, which of the team's repositories do I
 * have — and then starts this machine's runner so there is nothing left to do.
 *
 * It fails the way a person needs it to: "you're not on the tailnet" and
 * "no owner has added you, ask alice@" are different problems with different
 * fixes, and each is said as what it is.
 */
export async function cmdJoin(rawUrl: string | undefined, opts: { token?: string; repos: string[] }): Promise<number> {
  if (!rawUrl) {
    out(dim("  usage: ") + "kandy join <hub-url>")
    out(faint("  the hub's owner has the url — it looks like https://kandy-hub.your-tailnet.ts.net"))
    return 1
  }
  const url = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/+$/, "")

  // 1. Can this machine reach it at all?
  out(`  ${dim("hub")}     ${url}`)
  try {
    const res = await fetch(url + "/health", { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    out(berry("  cannot reach it."))
    if (url.includes(".ts.net")) {
      const ts = await tailscaleStatus()
      out(dim(`  ${ts.ok ? "Tailscale is up here — check the url, or ask the owner whether the hub is running." : explain(ts.reason)}`))
    }
    return 1
  }

  // 2. Who does it think we are?
  const probe = new (await import("@kandy/client")).KandyClient({ baseUrl: url, token: () => opts.token ?? "" })
  let me: Awaited<ReturnType<typeof probe.me>>
  try {
    me = await probe.me()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/identity|Tagged/i.test(msg)) {
      out(berry("  the hub cannot tell who this machine belongs to."))
      out(dim("  Either this machine is not on the tailnet, or it is a tagged device — tagged devices"))
      out(dim("  carry no person's identity, and a hub will not run anyone's work on one."))
    } else if (/token/i.test(msg)) {
      out(berry("  this hub wants a token.") + dim(" Ask its owner for it: kandy join <url> --token <token>"))
    } else {
      out(berry(`  ${msg}`))
    }
    return 1
  }
  if (!me.hub) {
    out(berry("  that is a single-person kandy, not a team hub.") + dim(" Its owner starts one with: kandy hub --tailscale"))
    return 1
  }

  const repos = opts.repos.map((r) => realpathSync(path.resolve(r)))
  saveJoined({ url, token: opts.token ?? "", repos, email: me.email, joinedAt: Date.now() })

  if (!me.admitted) {
    out(`  ${dim("you")}     ${bold(me.email ?? "?")}`)
    out()
    out(lemon("  Nobody has added you to this hub yet."))
    const owners = me.owners.length ? me.owners.join(", ") : "one of its owners"
    out(dim(`  Ask ${owners} to run:`))
    out(`    kandy invite ${me.email ?? "<your email>"}`)
    out(dim("  That's all. This machine is set up and will connect the moment they do."))
    return 0
  }
  out(`  ${dim("you")}     ${bold(me.email ?? "the only person")}${me.role ? dim(` · ${me.role}`) : ""}`)

  // 3. What can run here?
  const agents = (await detectAll()).filter((a) => a.installed)
  const ready = agents.filter((a) => a.authed)
  out(
    `  ${dim("agents")}  ${ready.length ? ready.map((a) => mint(a.id)).join(" ") : lemon("none signed in")}` +
      (agents.length > ready.length ? dim(`  (signed out: ${agents.filter((a) => !a.authed).map((a) => a.id).join(", ")})`) : ""),
  )
  if (!ready.length) out(dim("  Sign in to one — `claude`, `codex login`, `cursor-agent login` — and notes can run here."))

  // 4. Which of the team's repositories are on this machine?
  let boards: Board[] = []
  try {
    boards = (await client().boards()).boards
  } catch {
    // Listing is a courtesy; the runner finds clones on its own either way.
  }
  if (boards.length) {
    out(`  ${dim("repos")}`)
    const clones = await localClones(repos)
    for (const b of boards) {
      const here =
        (b.remote && clones.get(b.remote)) ||
        (existsSync(path.join(b.repoPath, ".git")) ? b.repoPath : null)
      out(here ? `    ${mint("✓")} ${bold(b.name)} ${dim(here)}` : `    ${faint("·")} ${b.name} ${faint(`— no clone here${b.remote ? ` of ${b.remote}` : ""}`)}`)
    }
    out(faint("    notes on a board without a clone here run on someone else's machine"))
  }

  // 5. Start the runner, and wait until the hub has seen it.
  if (!runnerPid()) startRunner()
  const seen = await waitForRunner(15_000)
  out(
    `  ${dim("runner")}  ${seen ? mint("connected") : lemon("starting…")}` +
      (seen ? "" : dim(`  (log: ${RUNNER_LOG})`)),
  )

  out()
  out(`  ${mint("You're in.")} ${dim("Your notes run on this machine, with your agents and logins.")}`)
  out(`    ${bold("kandy")}                       ${dim("the board, in this terminal")}`)
  out(`    ${bold('kandy "fix the login flash"')}  ${dim("a note, from inside one of those repos")}`)
  out(`    ${bold(url)}  ${dim("the board, in a browser")}`)
  out(faint("  kandy leave takes this machine off the team."))
  return 0
}

/** `kandy leave` — back to one person, one machine. */
export async function cmdLeave(): Promise<number> {
  const hub = joinedHub()
  const pid = runnerPid()
  if (pid) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  if (!forgetJoined()) {
    out(dim("  this machine is not on a team"))
    return 0
  }
  out(`  ${mint("left")} ${dim(hub?.url ?? "")}`)
  out(dim("  Notes you started there stay on the board; their branches are wherever you pushed them."))
  return 0
}

/**
 * `kandy invite <email> [--role member]` — admit someone, and hand them the
 * words to paste. Admitting is half of it; the other half is the new person
 * knowing what to do, which is what the message is for.
 */
export async function cmdInvite(email: string | undefined, role: string | undefined): Promise<number> {
  const hub = joinedHub()
  if (!hub) {
    out(berry("  this machine is not on a team.") + dim(" Run kandy join <hub-url> first — only a hub knows who is on it."))
    return 1
  }
  if (!email || !email.includes("@")) {
    out(dim("  usage: ") + "kandy invite <email> [--role member|viewer|owner]")
    return 1
  }
  const r = (role ?? "member") as Role
  if (!ROLES.includes(r)) {
    out(berry(`  --role must be one of ${ROLES.join(", ")}`))
    return 1
  }
  try {
    await client().setMember(email, r)
  } catch (err) {
    out(berry(`  ${err instanceof Error ? err.message : String(err)}`))
    return 1
  }
  out(`  ${mint("added")} ${bold(email)} ${dim(`as ${r}`)}`)
  out()
  out(dim("  Send them this:"))
  out()
  for (const line of inviteMessage(hub.url)) out(`    ${line}`)
  out()
  return 0
}

/** The words a new person needs, in the order they need them. Shared with the web app's copy. */
export function inviteMessage(url: string): string[] {
  return [
    `You're on the kandy hub at ${url}`,
    `1. Make sure you're on our Tailscale network.`,
    `2. Install kandy:  ${INSTALL_COMMAND}`,
    `3. Connect your machine:  kandy join ${url}`,
    `Your notes run on your own machine, with your own agents.`,
  ]
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Clones on this machine, by normalised remote: the ones named, then the usual places. */
async function localClones(explicit: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const candidates = [...explicit, ...nearby(80).map((e) => e.path)]
  await Promise.all(
    candidates.map(async (p) => {
      const remote = await originOf(p).catch(() => null)
      if (remote && !found.has(remote)) found.set(remote, p)
    }),
  )
  return found
}

/** Wait until the hub lists this machine's runner as online. */
async function waitForRunner(ms: number): Promise<boolean> {
  let me: string | null = null
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      me ??= readFileSync(path.join(STATE_DIR, "runner-id"), "utf8").trim()
      const { runners } = await client().runners()
      if (runners.some((r) => r.runnerId === me && r.online)) return true
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * `kandy consent [nobody|approved|team]`, `kandy consent revoke <email>` —
 * who may run notes on this machine besides you.
 *
 * The setting lives on this machine, in a file only you can write, and is read
 * fresh on every request — so a change here applies to a running runner at
 * once. See consent.ts for why it is not a hub setting.
 */
export async function cmdConsent(args: string[]): Promise<number> {
  const { ConsentStore } = await import("../consent.js")
  const store = new ConsentStore()
  const [verb, arg] = args

  if (verb === "nobody" || verb === "approved" || verb === "team") {
    store.setAccept(verb)
  } else if (verb === "revoke" || verb === "approve") {
    if (!arg || !arg.includes("@")) {
      out(dim("  usage: ") + `kandy consent ${verb} <email>`)
      return 1
    }
    if (verb === "revoke") store.revoke(arg)
    else store.approve(arg)
  } else if (verb !== undefined) {
    out(dim("  usage: ") + "kandy consent [nobody | approved | team]   ·   kandy consent revoke <email>")
    return 1
  }

  const c = store.get()
  const MEANS = {
    nobody: "only your own notes run here",
    approved: "your notes, and people you've approved — anyone else's waits for you",
    team: "anyone on the hub",
  } as const
  out(`  ${dim("accept")}    ${bold(c.accept)} ${faint(`— ${MEANS[c.accept]}`)}`)
  out(`  ${dim("approved")}  ${c.approved.length ? c.approved.join(", ") : faint("nobody yet")}`)
  return 0
}
