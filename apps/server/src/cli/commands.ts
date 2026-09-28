import { execFile } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { splitPrompt, type AgentId, type Board, type BoardView, type Note } from "@kandy/core"
import { banner, berry, bold, dim, faint, heat, lemon, mint, sparkline, statusTag } from "./banner.js"
import { client, ensureUp, hubFor } from "./daemon.js"
import type { Reclaimable } from "../gc.js"
import { findReclaimable, findStrippable, strip, heldBack, humanBytes, reclaim } from "../gc.js"
import { originOf } from "../worktree.js"
import { STATE_DIR } from "../paths.js"
import { preferredPolicy } from "./setup.js"
import { failureOf } from "../tui/board.js"
import { notInstalled, SIGN_IN } from "../agents/hints.js"

/** "1 file", "2 files". */
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

const exec = promisify(execFile)
const out = (s = "") => process.stdout.write(s + "\n")

/** The board whose repo contains the current directory. */
export async function boardHere(port: number): Promise<{ board: Board; view: BoardView } | null> {
  const api = client(port)
  const cwd = await exec("git", ["rev-parse", "--show-toplevel"])
    .then((r) => r.stdout.trim())
    .catch(() => process.cwd())

  const { boards } = await api.boards()
  // Longest match wins, so a repo nested inside another picks the inner one.
  const byPath = boards
    .filter((b) => cwd === b.repoPath || cwd.startsWith(b.repoPath + "/"))
    .sort((a, b) => b.repoPath.length - a.repoPath.length)[0]
  /*
   * On a team the path in a board is where the repository is on whoever made
   * it; yours is somewhere else. The remote is the same for everyone, so a
   * board is found by it when the path says nothing.
   */
  const origin = byPath ? null : await originOf(cwd).catch(() => null)
  const match = byPath ?? (origin ? boards.find((b) => b.remote === origin) : undefined)
  if (!match) return null
  return { board: match, view: await api.view(match.id) }
}

/**
 * Make a board for the repo we're standing in.
 *
 * The alternative is telling someone to go to the web UI to do a thing the CLI
 * could obviously do itself — and the repo is already unambiguous from cwd.
 */
export async function adoptHere(port: number): Promise<{ board: Board; view: BoardView } | null> {
  const api = client(port)
  const check = await api.checkRepo(process.cwd())
  if (!check.isRepo) {
    out(berry("  not a git repository") + dim(` — ${process.cwd()}`))
    return null
  }
  const { board } = await api.createBoard(check.name ?? "board", check.path, undefined, undefined, preferredPolicy())
  out(`  ${mint("created board")} ${bold(board.name)} ${dim(check.path)}`)
  return { board, view: await api.view(board.id) }
}

export async function cmdNew(
  args: string[],
  opts: { port: number; agent: AgentId | undefined; run: boolean },
): Promise<number> {
  const title = args.join(" ").trim()
  if (!title) {
    out(berry("  say what you want done:") + dim(' kandy new "fix the login flash"'))
    return 1
  }
  // Before anything is made: a note for an agent that cannot run here would
  // be announced as running and then fail.
  if (opts.agent && !(await agentCanRun(opts.agent, opts.run))) return 1
  // A worktree branches from a commit, and there isn't one yet.
  if (opts.run && (await noCommits())) {
    out(berry("  this repo has no commits yet") + dim(" — make a first commit, then run it again"))
    return 1
  }
  if (!(await ensureUp(opts.port))) return fail()

  const here = (await boardHere(opts.port)) ?? (await adoptHere(opts.port))
  if (!here) return 1

  const api = client(opts.port)
  const column = here.view.columns[0]?.id
  if (!column) {
    out(berry("  board has no columns"))
    return 1
  }

  // A shell gives us one string, so the first line is the title and the rest
  // is the detail. The agent is given both either way; the split only decides
  // what shows in the list. Same rule as a paste into the composer.
  const { title: first, body: rest } = splitPrompt(title)
  const { noteId } = await api.createNote(here.board.id, column, first, rest)

  /*
   * Which agent, when none was named: the last one that ran on this board,
   * if it can still run here, and otherwise the first that can. `kandy "fix
   * it"` promises that an agent runs it; without a default it quietly wrote
   * a draft and ran nothing unless --agent was given.
   */
  const agent = opts.agent ?? (opts.run ? await defaultAgent(api, here.view) : undefined)
  if (opts.run && !agent) {
    out(lemon("  no agent is signed in here") + dim(" — saved as a draft"))
    out(dim("  sign in to one (claude · codex login · cursor-agent login), then: ") + "kandy run")
  }
  if (agent) await api.assignNote(noteId, agent)
  if (opts.run && agent) await api.runNote(noteId, agent)

  out(
    `  ${mint("✓")} ${bold(first)}` +
      (opts.run && agent ? dim(`  running with ${agent}`) : agent ? dim(`  assigned to ${agent}`) : ""),
  )
  out(dim(`    ${boardUrl(opts.port)}`))
  return 0
}

/**
 * `kandy run [words]` — run a note that is waiting here.
 *
 * With no words, the newest draft; with words, the one note whose id starts
 * with them or whose title contains them. It is where "no agent is signed in,
 * saved as a draft" leads: without it the only way on from a draft was the
 * board.
 */
export async function cmdRun(args: string[], opts: { port: number; agent: AgentId | undefined }): Promise<number> {
  if (opts.agent && !(await agentCanRun(opts.agent, true))) return 1
  if (!(await ensureUp(opts.port))) return fail()
  const here = await boardHere(opts.port)
  if (!here) {
    out(dim("  no board for this repo yet — ") + `kandy "…"` + dim(" writes a note and runs it"))
    return 1
  }

  const pick = pickNote(here.view.notes, args.join(" "))
  if (pick.kind === "none") {
    out(dim(pick.query ? `  no note here matches "${pick.query}"` : "  no drafts here to run — ") + (pick.query ? "" : `kandy "…"`))
    return 1
  }
  if (pick.kind === "many") {
    out(lemon(`  ${pick.notes.length} notes match`) + dim(" — say which, by more of its title or its id:"))
    for (const n of pick.notes.slice(0, 8)) out(`    ${faint(n.id.slice(0, 12))}  ${n.title}`)
    return 1
  }
  const note = pick.note
  if (note.status === "running" || note.status === "queued" || note.status === "blocked") {
    out(dim(`  already running — ${note.title}`))
    return 0
  }
  if (note.status === "review" || note.status === "done") {
    out(dim(`  ${note.status === "review" ? "waiting for review" : "already done"} — ${note.title}`))
    return 1
  }

  const api = client(opts.port)
  const ready = await readyAgents()
  const agent =
    opts.agent ?? (note.agent && ready.includes(note.agent) ? note.agent : await defaultAgent(api, here.view))
  if (!agent) {
    out(lemon("  no agent is signed in here") + dim(" — sign in to one (claude · codex login · cursor-agent login), then run this again"))
    return 1
  }
  if (await noCommits()) {
    out(berry("  this repo has no commits yet") + dim(" — make a first commit, then run it again"))
    return 1
  }
  if (note.agent !== agent) await api.assignNote(note.id, agent)
  await api.runNote(note.id, agent)
  out(`  ${mint("✓")} ${bold(note.title)}${dim(`  running with ${agent}`)}`)
  out(dim(`    ${boardUrl(opts.port)}`))
  return 0
}

/** Which note `kandy run` means: the newest draft, or the one that matches. */
export function pickNote(
  notes: readonly Note[],
  query: string,
): { kind: "one"; note: Note } | { kind: "many"; notes: Note[] } | { kind: "none"; query: string } {
  const q = query.trim()
  if (!q) {
    const draft = notes.filter((n) => n.status === "draft").sort((a, b) => b.createdAt - a.createdAt)[0]
    return draft ? { kind: "one", note: draft } : { kind: "none", query: "" }
  }
  const byId = notes.filter((n) => n.id.startsWith(q))
  if (byId.length === 1) return { kind: "one", note: byId[0]! }
  const lower = q.toLowerCase()
  const exact = notes.filter((n) => n.title.toLowerCase() === lower)
  if (exact.length === 1) return { kind: "one", note: exact[0]! }
  // Finished work is not what anyone means by "run".
  const byTitle = notes.filter((n) => n.status !== "done" && n.title.toLowerCase().includes(lower))
  if (byTitle.length === 1) return { kind: "one", note: byTitle[0]! }
  if (byTitle.length > 1) return { kind: "many", notes: byTitle }
  return { kind: "none", query: q }
}

export async function cmdList(opts: { port: number; all: boolean }): Promise<number> {
  if (!(await ensureUp(opts.port))) return fail()
  const here = await boardHere(opts.port)
  if (!here) {
    if (!(await insideRepo())) {
      out(dim("  not a git repository — ") + "git init" + dim(" here, or cd into a repo"))
      return 0
    }
    out(dim("  no board for this repo yet — ") + `kandy new "…"` + dim(" will make one"))
    return 0
  }

  const notes = here.view.notes.filter((n) => opts.all || n.status !== "done")
  if (notes.length === 0) {
    // "nothing here" is false when a board is full of finished work. Say what
    // is being hidden and how to see it.
    const done = here.view.notes.length
    if (done > 0 && !opts.all) {
      out(dim(`  nothing open — ${done} done. `) + "kandy ls --all" + dim(" to see them"))
    } else {
      out(dim("  nothing here. ") + `kandy new "…"`)
    }
    return 0
  }

  out()
  out(`  ${bold(here.board.name)} ${dim(here.board.repoPath)}`)
  out()
  for (const n of byUrgency(notes)) {
    const run = here.view.runs.find((r) => r.id === n.runId)
    const bits = [
      n.agent ? faint(n.agent) : "",
      n.stat ? faint(`+${n.stat.insertions} -${n.stat.deletions}`) : "",
      run?.tokens ? faint(`${Math.round(run.tokens / 1000)}k tok`) : "",
      n.pr ? mint(`#${n.pr.number}`) : "",
    ].filter(Boolean)
    const why = n.status === "failed" ? failureOf(run) : null
    out(`  ${statusTag(n.status, why?.kind).padEnd(22)} ${n.title}`)
    if (bits.length) out(`  ${" ".repeat(13)} ${bits.join(dim(" · "))}`)
    if (why?.kind === "interrupted") {
      out(`  ${" ".repeat(13)} ${dim("kandy stopped while this ran — ")}kandy run ${n.id}${dim(" resumes it")}`)
    } else if (why?.reason) {
      out(`  ${" ".repeat(13)} ${dim(why.reason.length > 100 ? why.reason.slice(0, 99) + "…" : why.reason)}`)
    }
  }
  out()
  return 0
}

export async function cmdStatus(opts: { port: number; json?: boolean }): Promise<number> {
  const hub = hubFor(opts.port)
  const up = await ensureUp(opts.port)
  if (opts.json) return statusJson(opts.port, up)
  out(banner(hub ? (up ? hub.url : "hub unreachable") : up ? `running on :${opts.port}` : "not running"))
  if (!up) return 1

  const api = client(opts.port)
  const [{ boards }, { agents }] = await Promise.all([api.boards(), api.agents()])

  if (hub) {
    // On a team the questions are different: who am I here, and is my
    // machine actually taking work — a runner that is down means my notes
    // sit waiting for a machine that never arrives.
    const [me, { runners }] = await Promise.all([api.me(), api.runners()])
    // This machine's own runner, by the id it keeps — not by email, which a
    // hub with no identity does not have.
    const myId = (() => {
      try {
        return readFileSync(path.join(STATE_DIR, "runner-id"), "utf8").trim()
      } catch {
        return null
      }
    })()
    const mine = runners.filter((r) => r.runnerId === myId)
    out(`  ${dim("team")}   ${bold(me.email ?? "the only person")}${me.role ? dim(` · ${me.role}`) : ""}`)
    out(
      `  ${dim("runner")} ${mine.some((r) => r.online) ? mint("connected") : lemon("not connected")}` +
        dim(`  · ${runners.filter((r) => r.online).length} machine(s) online on the hub`),
    )
    if (!me.admitted) out(lemon("  nobody has added you yet") + dim(` — ask ${me.owners.join(", ") || "an owner"}`))
    out()
  }

  out(`  ${dim("repos")}`)
  for (const b of boards) out(`    ${bold(b.name)} ${dim(b.repoPath)}`)

  out()
  out(`  ${dim("agents")}`)
  for (const a of agents) {
    const state = !a.installed ? faint("not installed") : a.authed ? mint("ready") : lemon("signed out")
    // Signed out is one command from ready; say which.
    const next = a.installed && !a.authed && SIGN_IN[a.id] ? dim(`— ${SIGN_IN[a.id]}`) : dim(a.version ?? "")
    out(`    ${a.id.padEnd(10)} ${state} ${next}`)
  }
  out()
  out(`  ${dim("board")}  ${boardUrl(opts.port)}`)
  out()
  return 0
}

/**
 * `kandy status --json`: the same facts, in a shape a script can hold on to.
 *
 * Keys are only ever added. `daemon.up` false is still a document rather than
 * prose on stderr, because a script's first question is usually that one.
 */
async function statusJson(port: number, up: boolean): Promise<number> {
  const hub = hubFor(port)
  const url = boardUrl(port)
  if (!up) {
    out(JSON.stringify({ daemon: { up: false, url, port }, hub: hub ? { url: hub.url } : null }, null, 2))
    return 1
  }
  const api = client(port)
  const [health, { boards }, { agents }] = await Promise.all([api.health(), api.boards(), api.agents()])
  let running = 0
  let queued = 0
  const repos = []
  for (const b of boards) {
    const view = await api.view(b.id).catch(() => null)
    const notes = view?.notes ?? []
    running += notes.filter((n) => n.status === "running" || n.status === "blocked").length
    queued += notes.filter((n) => n.status === "queued").length
    repos.push({
      id: b.id,
      name: b.name,
      path: b.repoPath,
      notes: {
        open: notes.filter((n) => n.status !== "done").length,
        running: notes.filter((n) => n.status === "running" || n.status === "blocked").length,
        review: notes.filter((n) => n.status === "review").length,
      },
    })
  }
  let team = null
  if (hub) {
    const [me, { runners }] = await Promise.all([api.me(), api.runners()])
    team = {
      url: hub.url,
      email: me.email ?? null,
      role: me.role ?? null,
      admitted: me.admitted,
      machinesOnline: runners.filter((r) => r.online).length,
    }
  }
  out(
    JSON.stringify(
      {
        daemon: { up: true, url, port, pid: health.pid, version: health.version, uptimeMs: health.uptime },
        hub: team,
        repos,
        agents: agents.map((a) => ({
          id: a.id,
          state: !a.installed ? "not installed" : a.authed ? "ready" : "signed out",
          installed: a.installed,
          authed: a.authed,
          version: a.version,
          signIn: a.installed && !a.authed ? (SIGN_IN[a.id] ?? null) : null,
        })),
        runs: { running, queued },
      },
      null,
      2,
    ),
  )
  return 0
}

/** Duration in the shortest form that is still honest. */
function dur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const usd = (n: number, est: boolean) => `${est ? "≈" : ""}$${n.toFixed(2)}`

export async function cmdStats(opts: { port: number; json?: boolean }): Promise<number> {
  if (!(await ensureUp(opts.port))) return fail()
  const here = await boardHere(opts.port)
  if (!here) {
    // Machine readers get a shape they can branch on rather than prose on
    // stdout they would have to parse to discover there is nothing here.
    if (opts.json) out(JSON.stringify({ board: null }))
    else out(dim("  no board for this repo yet"))
    return 0
  }

  const api = client(opts.port)
  const s = await api.stats(here.board.id)

  // The server's projection is already the whole answer. Print it verbatim
  // rather than reassembling a subset here — a second shape to keep in step
  // with the first is how the two drift apart.
  if (opts.json) {
    out(JSON.stringify({ ...s, generatedAt: new Date().toISOString() }, null, 2))
    return 0
  }

  const row = (label: string, value: string, note = "") =>
    out(`  ${faint(label.padEnd(20))} ${value}${note ? dim(`  ${note}`) : ""}`)

  out()
  out(`  ${bold(s.board.name)}`)
  out()
  out(
    `  ${bold(String(s.notes.total))} ${s.notes.total === 1 ? "note" : "notes"}` +
      dim(" · ") +
      mint(`${s.notes.landed} landed`) +
      dim(" · ") +
      `${s.notes.discarded} discarded` +
      (s.notes.open ? dim(" · ") + lemon(`${s.notes.open} open`) : ""),
  )
  out(
    `  ${bold(usd(s.spend.usd, s.spend.estimated))}` +
      dim(` across ${plural(s.runs.total, "run")} · ${s.spend.tokens.toLocaleString()} ${s.spend.tokens === 1 ? "token" : "tokens"}`) +
      (s.spend.unpricedRuns ? dim(` · ${s.spend.unpricedRuns} unpriced`) : ""),
  )
  out()

  if (s.firstTry.of > 0) {
    const pct = Math.round((s.firstTry.landed / s.firstTry.of) * 100)
    row("landed first try", `${s.firstTry.landed} of ${s.firstTry.of}`, `${pct}%`)
  }
  if (s.code.insertions + s.code.deletions > 0) {
    row("code written", `${mint("+" + s.code.insertions)} ${berry("-" + s.code.deletions)}`,
      plural(s.code.files, "file"))
  }
  if (s.linesPerDollar) row("lines per dollar", s.linesPerDollar.toLocaleString())
  if (s.tokensPerLine) row("tokens per line", s.tokensPerLine.toLocaleString())
  if (s.runs.medianMs !== null) row("median run", dur(s.runs.medianMs))
  if (s.runs.longest) row("longest run", dur(s.runs.longest.ms), s.runs.longest.title.slice(0, 42))
  if (s.priciest)
    row("priciest note", usd(s.priciest.usd, s.priciest.estimated), s.priciest.title.slice(0, 42))
  if (s.busiestHour)
    row(
      "busiest hour",
      `${String(s.busiestHour.hour).padStart(2, "0")}:00`,
      plural(s.busiestHour.runs, "run"),
    )
  if (s.tools[0]) row("most used tool", s.tools[0].tool, plural(s.tools[0].calls, "call"))

  // The activity map: twelve weeks, a column per week, a row per weekday.
  if (s.daily.some((d) => d.runs > 0)) {
    out()
    const max = Math.max(...s.daily.map((d) => d.runs))
    const level = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)))

    // Pad the front so the first column starts on a Sunday, as a calendar does.
    const lead = new Date(s.daily[0]!.date + "T00:00:00").getDay()
    const cells: (number | null)[] = [...Array(lead).fill(null), ...s.daily.map((d) => d.runs)]

    for (let row = 0; row < 7; row++) {
      const line: string[] = []
      for (let i = row; i < cells.length; i += 7) {
        const v = cells[i]
        line.push(v === null || v === undefined ? " " : heat(level(v)))
      }
      const label = row === 1 ? "mon" : row === 3 ? "wed" : row === 5 ? "fri" : "   "
      out(`  ${faint(label)} ${line.join(" ")}`)
    }
    out(`  ${faint("      12 weeks")}${dim(" · ")}${faint(`busiest day ${plural(max, "run")}`)}`)
  }

  if (s.hours.some((h) => h > 0)) {
    out()
    out(`  ${faint("by hour")}      ${sparkline(s.hours)}`)
    out(`  ${faint("             00")}${faint("          06          12          18")}`)
  }

  // Where work goes, and where it stops. The one shape only kandy can draw.
  const f = s.funnel
  if (f.written > 0) {
    const width = 24
    const bar = (n: number) => {
      // Clamped: a stage can never be wider than the whole, and a negative
      // repeat count throws rather than just looking wrong.
      const filled = Math.max(0, Math.min(width, Math.round((n / Math.max(f.written, 1)) * width)))
      return mint("█".repeat(filled)) + dim("░".repeat(width - filled))
    }
    out()
    out(`  ${faint("written ")} ${bar(f.written)} ${f.written}`)
    out(`  ${faint("ran     ")} ${bar(f.ran)} ${f.ran}`)
    out(`  ${faint("reviewed")} ${bar(f.reviewed)} ${f.reviewed}`)
    out(`  ${faint("landed  ")} ${bar(f.landed)} ${f.landed}`)
    if (f.lost > 0) out(`  ${faint("lost    ")} ${dim("─".repeat(width))} ${berry(String(f.lost))}`)
  }

  if (s.agents.length > 0) {
    out()
    for (const a of s.agents) {
      out(
        `  ${bold(a.agent.padEnd(9))}` +
          `${a.landed} landed` +
          dim(` · ${a.discarded} discarded · ${plural(a.runs, "run")} · `) +
          usd(a.usd, a.estimated) +
          (a.medianMs !== null ? dim(` · median ${dur(a.medianMs)}`) : ""),
      )
    }
  }
  out()
  return 0
}

/**
 * Reclaim the checkouts of notes that are finished.
 *
 * Every note gets a full worktree, and only the daemon that made one knows
 * where it is — restart it and those checkouts are stranded inside the repo.
 * On a board that has run a hundred notes that is a hundred copies of the
 * tree, node_modules and all.
 *
 * The branch is never touched. Removing a checkout is reversible as long as
 * the commits survive, and that asymmetry is the whole safety story: unmerged
 * or uncommitted work is held back until the user says --force.
 */
export async function cmdGc(opts: {
  port: number
  dryRun: boolean
  force: boolean
}): Promise<number> {
  if (!(await ensureUp(opts.port))) return fail()
  const here = await boardHere(opts.port)
  if (!here) {
    out(dim("  no board for this repo yet — nothing to reclaim"))
    return 0
  }

  /*
   * Notes naming a checkout that is not there.
   *
   * Removing a worktree used to leave the note still pointing at it, so the
   * board reported disk nobody was using — twenty-one of them on the repo that
   * found this. Nothing to free; it is the record that is wrong, and gc is
   * where disk housekeeping already lives.
   */
  const stale = here.view.notes.filter((n) => n.worktree && !existsSync(n.worktree))
  for (const n of stale) {
    await client(opts.port).noteReclaimed(n.id).catch(() => {})
  }
  if (stale.length > 0) {
    out()
    out(dim(`  corrected ${stale.length} note${stale.length === 1 ? "" : "s"} still naming a checkout that was already gone`))
  }

  /*
   * Every note id the daemon knows, not just this board's.
   *
   * A directory under this repo's worktree root whose note no board claims is
   * an orphan and ours to reclaim. One whose note belongs to *another* board on
   * the same repo is that board's business and may well be running right now —
   * which is the distinction the whole check turns on.
   */
  const boards = await client(opts.port).boards().catch(() => ({ boards: [] as typeof here.board[] }))
  const known = new Set<string>()
  for (const b of boards.boards) {
    if (b.repoPath !== here.board.repoPath) continue
    const view = await client(opts.port).view(b.id).catch(() => null)
    for (const n of view?.notes ?? []) known.add(n.id)
  }

  const found = await findReclaimable(here.board.repoPath, here.view.notes, known)
  const strippable = await findStrippable(here.board.repoPath, here.view.notes)

  /*
   * Never "nothing to reclaim" while there is something on disk.
   *
   * This used to say exactly that about 810MB — true of the narrow question it
   * asked (are any *finished* notes holding a checkout?) and useless to the
   * person running it, who could see the disk being used. Silence about what
   * was skipped is indistinguishable from gc being broken.
   */
  if (found.length === 0 && strippable.length === 0) {
    if (stale.length === 0) out(dim("  nothing to reclaim — no checkout is holding rebuildable files"))
    return 0
  }

  out()
  // Colour codes make a string longer than it looks, so pad the plain label and
  // colour the result — otherwise the size column walks left and right.
  const VERB = 10
  const row = (verb: string, colour: (s: string) => string, item: { bytes: number; title: string }, tail = "") =>
    out(
      `  ${colour(verb.padEnd(VERB))} ${faint(humanBytes(item.bytes).padStart(8))}  ${item.title}${tail}`,
    )
  const under = (text: string) => out(`  ${" ".repeat(VERB + 11)}${dim(text)}`)
  const how = (item: Reclaimable) =>
    dim(item.outcome === "discarded" ? "  discarded" : item.outcome === "merged" ? "  merged" : "")

  let freed = 0
  let held = 0
  for (const item of found) {
    const why = heldBack(item, opts.force)

    if (why) {
      held++
      row("kept", lemon, item)
      under(`${why} — pass --force to remove it`)
      continue
    }

    if (opts.dryRun) {
      freed += item.bytes
      row("would free", faint, item, how(item))
      continue
    }

    try {
      await reclaim(here.board.repoPath, item, opts.force)
      freed += item.bytes
      // Tell the daemon, or the note goes on naming a checkout that is gone.
      // Best effort: the disk is already back, and a stale field is not worth
      // reporting a failed reclaim over.
      await client(opts.port).noteReclaimed(item.noteId).catch(() => {})
      row("freed", mint, item, how(item))
    } catch (err) {
      held++
      row("failed", berry, item)
      under(err instanceof Error ? err.message.split("\n")[0]! : String(err))
    }
  }

  /*
   * Checkouts that stay, lighter.
   *
   * Notes in review or failed keep their worktree — the diff is right there
   * and a follow-up run continues in it — but not their node_modules. The
   * runner is told, and reinstalls before the next agent arrives.
   */
  let stripped = 0
  for (const item of strippable) {
    if (opts.dryRun) {
      row("would trim", faint, item, dim(`  ${item.status}`))
    } else {
      try {
        strip(item)
        row("trimmed", mint, item, dim(`  ${item.status}`))
      } catch (err) {
        row("failed", berry, item)
        under(err instanceof Error ? err.message.split("\n")[0]! : String(err))
        continue
      }
    }
    stripped++
    freed += item.bytes
  }
  if (strippable.length > 0) {
    under(`${strippable.map((s) => s.dirs.length).reduce((a, b) => a + b, 0)} rebuildable folders — the checkout and its changes stay; the next run reinstalls`)
  }

  out()
  const removed = found.length - held
  const parts = [
    removed ? `${removed} worktree${removed === 1 ? "" : "s"} removed` : "",
    stripped ? `${stripped} trimmed` : "",
    held ? `${held} kept` : "",
  ].filter(Boolean)
  out(
    `  ${bold(humanBytes(freed))} ${opts.dryRun ? "would be reclaimed" : "reclaimed"}` +
      (parts.length ? dim(` · ${parts.join(" · ")}`) : ""),
  )
  // The commits are the work; the checkout was only a place to do it.
  out(dim("  branches are left alone"))
  out()
  return 0
}

/**
 * Put the kandy skill where agents look for it.
 *
 * The skill ships in the repo, which scopes it to this checkout. Copying it to
 * ~/.claude/skills makes it available in every repository — which is the point,
 * since the whole idea is queueing work from wherever you happen to be.
 */
export async function cmdSkillInstall(): Promise<number> {
  // An install carries it in dist/skill (the build copies it there); a
  // source checkout has it at the repo root.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, "../skill/SKILL.md"),
    path.resolve(here, "../../../../.claude/skills/kandy/SKILL.md"),
  ]
  const source = candidates.find((p) => existsSync(p))
  if (!source) {
    out(berry("  cannot find the skill to install") + dim(`\n  looked in ${candidates.join(", ")}`))
    return 1
  }

  const target = path.join(homedir(), ".claude", "skills", "kandy")
  mkdirSync(target, { recursive: true })
  const dest = path.join(target, "SKILL.md")
  const existed = existsSync(dest)
  copyFileSync(source, dest)

  out(`  ${mint(existed ? "updated" : "installed")} ${dim(dest)}`)
  out(dim("  agents that read skills can now queue work onto a kandy board"))
  return 0
}

export async function cmdOpen(opts: { port: number }): Promise<number> {
  if (!(await ensureUp(opts.port))) return fail()
  const url = boardUrl(opts.port)
  out(dim("  opening ") + url)
  // `start` is built into cmd.exe rather than a program, so it is asked of
  // cmd; its first quoted argument is a window title, hence the empty one.
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]
  await exec(cmd, args, { windowsHide: true }).catch(() => out(dim(`  open ${url}`)))
  return 0
}

function byUrgency(notes: Note[]): Note[] {
  const order = ["blocked", "failed", "review", "running", "queued", "draft", "done"]
  return [...notes].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updatedAt - a.updatedAt,
  )
}

function fail(): number {
  // ensureUp has already said why: on a team, that the hub can't be reached;
  // here, what the daemon said as it failed to start, and where its log is.
  return 1
}

/** Where the board is: the team hub when this machine has joined one. */
function boardUrl(port: number): string {
  return hubFor(port)?.url ?? `http://127.0.0.1:${port}`
}

/**
 * The last agent that ran on this board if it is still ready, else the first ready one.
 *
 * Ready *here*: a note run from this machine runs on this machine, so it is
 * this machine's agents that count — asked directly, not of a hub that may
 * not have heard from this machine's runner yet.
 */
async function defaultAgent(_api: ReturnType<typeof client>, view: BoardView): Promise<AgentId | undefined> {
  const ready = await readyAgents()
  const last = [...view.runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]?.agent
  if (last && ready.includes(last)) return last
  const order: AgentId[] = ["claude", "codex", "cursor", "opencode", "aider"]
  return order.find((a) => ready.includes(a)) ?? ready[0]
}

/** The agents installed and signed in on this machine. */
async function readyAgents(): Promise<AgentId[]> {
  const { detectAll } = await import("../agents/index.js")
  return (await detectAll()).filter((a) => a.installed && a.authed).map((a) => a.id)
}

/**
 * Whether an agent named with --agent can run on this machine, said if not.
 *
 * A note that is only being written may name an agent that isn't here yet —
 * that is a warning. One that is about to run cannot: it would be announced
 * as running and fail a moment later.
 */
async function agentCanRun(agent: AgentId, run: boolean): Promise<boolean> {
  const { adapter, detect } = await import("../agents/index.js")
  const a = adapter(agent)
  if (!a) return false
  const info = await detect(a)
  const problem = !info.installed
    ? notInstalled(agent)
    : !info.authed
      ? `${agent} is signed out on this machine — sign in with ${SIGN_IN[agent] ?? `${agent}'s own login`}`
      : null
  if (!problem) return true
  out((run ? berry : lemon)(`  ${problem}`) + (run ? dim(", then run it again") : ""))
  return !run
}

/** Whether the current directory is inside a git repository. */
async function insideRepo(): Promise<boolean> {
  return exec("git", ["rev-parse", "--is-inside-work-tree"])
    .then((r) => r.stdout.trim() === "true")
    .catch(() => false)
}

/**
 * A repository with no commit yet. A note's worktree branches from HEAD, and
 * there is no HEAD — the run failed on a raw git error after being announced.
 */
async function noCommits(): Promise<boolean> {
  if (!(await insideRepo())) return false
  return exec("git", ["rev-parse", "--verify", "--quiet", "HEAD"])
    .then(() => false)
    .catch(() => true)
}
