import { existsSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { INSTALL_COMMAND, INSTALL_COMMAND_WINDOWS, ROLES, type Board, type Note, type Role, type RunnerInfo } from "@kandy/core"
import type { KandyClient } from "@kandy/client"
import { detectAll } from "../agents/index.js"
import { repos as nearby } from "../browse.js"
import { forgetJoined, joinedHub, RUNNER_LOG, runnerPid, runnerStatus, saveJoined, type Joined } from "../joined.js"
import { STATE_DIR, TOKEN_PATH } from "../paths.js"
import { explain, tailscaleStatus } from "../tailscale.js"
import { originOf } from "../worktree.js"
import { berry, bold, dim, faint, lemon, mint } from "./banner.js"
import { client, startRunner } from "./daemon.js"

const out = (s = "") => process.stdout.write(s + "\n")

/**
 * The hub's url, with a scheme when it was typed without one.
 *
 * https for a name — a tailnet hub is only ever that — but http for this
 * machine and for private addresses, which is where a token hub lives and
 * where nothing serves TLS. Guessing https there turned `kandy join
 * 127.0.0.1:4530` into "cannot reach it".
 */
export function hubUrl(raw: string): string {
  const typed = raw.trim().replace(/\/+$/, "")
  if (/^https?:\/\//i.test(typed)) return typed
  const host = typed.replace(/[/:].*$/, "").replace(/^\[|\]$/g, "").toLowerCase()
  return `${isNearby(host) || typed.startsWith("[") ? "http" : "https"}://${typed}`
}

function isNearby(host: string): boolean {
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true
  const ip = host.split(".").map(Number)
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = ip as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

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
  const url = hubUrl(rawUrl)
  if (!URL.canParse(url)) {
    out(berry(`  ${rawUrl} is not a url.`) + dim(" It looks like https://kandy-hub.your-tailnet.ts.net"))
    return 1
  }
  const tailnet = /\.ts\.net(:\d+)?$/i.test(new URL(url).host)

  // 1. Can this machine reach it at all? Any answer means yes: whether it
  // lets us in is the next question, and has its own answer.
  out(`  ${dim("hub")}     ${url}`)
  try {
    await fetch(url + "/health", { signal: AbortSignal.timeout(8000) })
  } catch {
    out(berry("  cannot reach it."))
    if (tailnet) {
      const ts = await tailscaleStatus()
      out(dim(`  ${ts.ok ? "Tailscale is up here — check the url, or ask the owner whether the hub is running." : explain(ts.reason)}`))
    } else if (!/^https?:\/\//i.test(rawUrl.trim()) && url.startsWith("https://")) {
      out(dim(`  If it has no https, say so: kandy join ${url.replace(/^https:/, "http:")}`))
    } else {
      out(dim("  Check the url, and that the hub is running there."))
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
      out(dim("  Join from a machine signed in to Tailscale as you."))
    } else if (/refused/i.test(msg)) {
      out(berry("  that token was refused.") + dim(" Check it with whoever runs the hub, then join again with --token."))
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
  /*
   * Let in is not the same as proven. On the hub's own machine the board
   * reads without a token, so a missing one got as far as "You're in" — and
   * the runner, which has to write, was then refused on every try.
   */
  if (me.authenticated === false) {
    out(berry("  this hub wants a token.") + dim(" Its runner could not connect without one."))
    if (isNearby(new URL(url).hostname.replace(/^\[|\]$/g, ""))) {
      out(dim(`  On the hub's own machine:  kandy join ${url} --token "$(cat '${TOKEN_PATH.replace(/'/g, `'\\''`)}')"`))
    } else {
      out(dim("  Ask whoever runs it: kandy join <url> --token <token>"))
    }
    return 1
  }
  if (me.removed) {
    out(`  ${dim("you")}     ${bold(me.email ?? "?")}`)
    out(berry("  you were removed from this hub."))
    const owners = me.owners.length ? me.owners.join(", ") : "one of its owners"
    out(dim(`  If that is a mistake, ask ${owners} to add you back: kandy invite ${me.email ?? "<your email>"}`))
    return 1
  }

  const before = joinedHub()
  // Repositories named at an earlier join stay named, unless this one names
  // others: re-joining to change a token should not quietly forget them.
  const repos = opts.repos.length ? opts.repos.map((r) => realpathSync(path.resolve(r))) : (before?.repos ?? [])
  const joined: Joined = { url, token: opts.token ?? "", repos, email: me.email, joinedAt: Date.now() }
  saveJoined(joined)
  // A runner started for another hub, token or set of clones is still
  // working for those. It is replaced, not kept because it happens to be up.
  const changed = !before || before.url !== url || before.token !== joined.token || before.repos.join("\n") !== repos.join("\n")

  if (!me.admitted) {
    out(`  ${dim("you")}     ${bold(me.email ?? "?")}`)
    out()
    const owners = me.owners.length ? me.owners.join(", ") : "one of its owners"
    out(lemon(`  Nobody has added you yet — ask ${owners} to run:`))
    out(`    kandy invite ${me.email ?? "<your email>"}`)
    // Started now, so there is nothing to do once they have: it keeps asking,
    // quietly, and is let in on the next try after they add you.
    await restartRunner(changed)
    out(dim("  That's all. This machine is saved and connects the moment they do."))
    return 0
  }
  out(`  ${dim("you")}     ${bold(me.email ?? "the only person")}${me.role ? dim(` · ${me.role}`) : ""}`)

  // A viewer looks; nothing of theirs runs, so there is no runner to start —
  // one would only be refused, over and over.
  if (me.role === "viewer") {
    await stopRunner()
    out()
    out(`  ${mint("You're in, as a viewer.")} ${dim("You can watch the board; notes don't run on this machine.")}`)
    out(`    ${bold("kandy")}  ${dim("the board, in this terminal")}   ${bold(url)}  ${dim("in a browser")}`)
    out(dim(`  To write and run notes, ask ${me.owners.join(", ") || "an owner"}: kandy invite ${me.email ?? "<your email>"} --role member`))
    out(faint("  Then run kandy join again."))
    return 0
  }

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
  await restartRunner(changed)
  const seen = await waitForRunner(15_000)
  const trouble = seen ? null : runnerStatus()
  out(
    `  ${dim("runner")}  ${seen ? mint("connected") : lemon("starting…")}` +
      (seen ? "" : dim(`  (log: ${RUNNER_LOG})`)),
  )
  if (trouble?.state === "offline" && trouble.why) out(dim(`  it says: ${trouble.why}`))

  out()
  out(`  ${mint("You're in.")} ${dim("Your notes run on this machine, with your agents and logins.")}`)
  out(`    ${bold("kandy")}                       ${dim("the board, in this terminal")}`)
  out(`    ${bold('kandy "fix the login flash"')}  ${dim("a note, from inside one of those repos")}`)
  out(`    ${bold(url)}  ${dim("the board, in a browser")}`)
  out(faint("  kandy leave takes this machine off the team."))
  return 0
}

/** Start this machine's runner, replacing one that is up with other settings. */
async function restartRunner(changed: boolean): Promise<void> {
  if (runnerPid() && changed) await stopRunner()
  if (!runnerPid()) startRunner()
}

/** Stop the background runner, and wait until it has gone. */
async function stopRunner(): Promise<void> {
  const pid = runnerPid()
  if (!pid) return
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  for (let i = 0; i < 40 && runnerPid() === pid; i++) await new Promise((r) => setTimeout(r, 125))
}

/** `kandy leave` — back to one person, one machine. */
export async function cmdLeave(): Promise<number> {
  const hub = joinedHub()
  await stopRunner()
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
  const api = client()
  const who = email.trim().toLowerCase()
  let had: Role | null = null
  try {
    had = (await api.members()).members.find((m) => m.email === who)?.role ?? null
  } catch {
    // Asked only to say "already a member"; setMember below says what is wrong.
  }
  // Someone already on the team has had their message. Only a change of role
  // is news, and only when one was asked for.
  if (had && (had === r || role === undefined)) {
    out(`  ${bold(who)} ${dim(`is already on this hub, as ${had === "owner" ? "an owner" : `a ${had}`}`)}`)
    if (had !== r) out(faint(`  to change that: kandy invite ${who} --role ${r}`))
    return 0
  }
  try {
    await api.setMember(email, r)
  } catch (err) {
    out(berry(`  ${err instanceof Error ? err.message : String(err)}`))
    return 1
  }
  if (had) {
    out(`  ${mint("changed")} ${bold(who)} ${dim(`from ${had} to ${r}`)}`)
    return 0
  }
  out(`  ${mint("added")} ${bold(email)} ${dim(`as ${r}`)}`)
  const remotes = await api
    .boards()
    .then(({ boards }) => [...new Set(boards.map((b) => b.remote).filter((x): x is string => Boolean(x)))])
    .catch(() => [] as string[])
  out()
  out(dim("  Send them this:"))
  out()
  for (const line of inviteMessage(hub.url, { role: r, remotes, tailnet: /\.ts\.net(:\d+)?$/i.test(new URL(hub.url).host) })) {
    out(`    ${line}`)
  }
  out()
  return 0
}

/**
 * The words a new person needs, in the order they need them.
 *
 * Says what they were added as, because a viewer following member
 * instructions would wonder why nothing runs; and which repositories to clone,
 * because notes run only where a clone of the board's repository is — by the
 * same remote, which is how their machine finds it.
 */
export function inviteMessage(url: string, o: { role?: Role; remotes?: string[]; tailnet?: boolean } = {}): string[] {
  const role = o.role ?? "member"
  const remotes = o.remotes ?? []
  const lines = [`You're on the kandy hub at ${url}, as ${role === "owner" ? "an owner" : `a ${role}`}.`]
  let n = 1
  if (o.tailnet !== false) lines.push(`${n++}. Make sure you're on our Tailscale network.`)
  lines.push(`${n++}. Install kandy:  ${INSTALL_COMMAND}`)
  lines.push(`   (on Windows, in PowerShell:  ${INSTALL_COMMAND_WINDOWS})`)
  lines.push(`${n++}. Connect your machine:  kandy join ${url}`)
  if (role === "viewer") {
    lines.push(`Then watch the board with \`kandy\`, or at ${url}.`)
    return lines
  }
  if (remotes.length) {
    lines.push(`${n++}. Have a clone of ${remotes.length === 1 ? "our repository" : "each repository you'll work on"}, from the same remote:`)
    for (const r of remotes) lines.push(`     git clone ${r}`)
  }
  lines.push(`Your notes run on your own machine, with your own agents.`)
  return lines
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

/** This machine's runner id, which it keeps across restarts. */
function myRunnerId(): string | null {
  try {
    return readFileSync(path.join(STATE_DIR, "runner-id"), "utf8").trim() || null
  } catch {
    return null
  }
}

/** Wait until the hub lists this machine's runner as online. */
async function waitForRunner(ms: number): Promise<boolean> {
  let me: string | null = null
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      me ??= myRunnerId()
      const { runners } = await client().runners()
      if (runners.some((r) => r.runnerId === me && r.online)) return true
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// ── consent ───────────────────────────────────────────────────────────────

/** What a note would be allowed to do on this machine, in the words a request should use. */
export function accessOf(policy: Note["policy"]): string {
  return policy === "full" ? "full access — it can run anything you can" : "repository only — it asks before anything else"
}

/** Notes someone has asked to run on this machine, waiting for its owner. */
export async function waitingHere(api: KandyClient, runnerId: string | null): Promise<{ boardId: string; note: Note }[]> {
  if (!runnerId) return []
  const { boards } = await api.boards()
  const views = await Promise.all(boards.map((b) => api.view(b.id).catch(() => null)))
  return views.flatMap((v) =>
    (v?.notes ?? []).filter((n) => n.held?.runnerId === runnerId).map((note) => ({ boardId: v!.board.id, note })),
  )
}

/**
 * The team half of `kandy status`: is this machine's runner taking work, and
 * if not, what did the hub last tell it — and is anyone waiting on a yes.
 */
export async function teamStatus(api: KandyClient, runners: RunnerInfo[]): Promise<void> {
  const id = myRunnerId()
  const connected = runners.some((r) => r.runnerId === id && r.online)
  out(
    `  ${dim("runner")} ${connected ? mint("connected") : lemon("not connected")}` +
      dim(`  · ${runners.filter((r) => r.online).length} machine(s) online on the hub`),
  )
  if (!connected) {
    const s = runnerStatus()
    if (!runnerPid()) out(dim("  it is not running — any kandy command starts it"))
    else if (s?.state === "offline" && s.why) out(dim(`  the hub said: ${s.why}`))
    out(faint(`  log: ${RUNNER_LOG}`))
  }
  const waiting = await waitingHere(api, id).catch(() => [])
  for (const { note } of waiting) {
    const who = note.held!.requestedBy ?? "someone"
    out(`  ${lemon("asks")}   ${bold(who)} wants to run ${bold(`"${note.title}"`)} here with ${note.held!.agent}`)
    out(dim(`         ${accessOf(note.policy)}`))
    if (note.held!.requestedBy) out(dim(`         kandy consent approve ${note.held!.requestedBy}   — runs it, and theirs from now on`))
  }
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
    else {
      store.approve(arg)
      await release(arg.trim().toLowerCase())
    }
  } else if (verb !== undefined) {
    out(dim("  usage: ") + "kandy consent [nobody | approved | team]   ·   kandy consent approve|revoke <email>")
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

/**
 * Approving someone answers what they already asked, too. Their notes held
 * on this machine were waiting for exactly this; leaving them waiting until
 * someone found the board and clicked would make "approve" mean "from next
 * time".
 */
async function release(email: string): Promise<void> {
  if (!joinedHub()) return
  const api = client()
  const waiting = await waitingHere(api, myRunnerId()).catch(() => [])
  for (const { note } of waiting) {
    if (note.held?.requestedBy?.toLowerCase() !== email) continue
    try {
      await api.consent(note.id, true, true)
      out(`  ${mint("started")} ${bold(`"${note.title}"`)} ${dim(`— ${email} asked for it`)}`)
    } catch (err) {
      out(berry(`  could not start "${note.title}": ${err instanceof Error ? err.message : String(err)}`))
    }
  }
}
