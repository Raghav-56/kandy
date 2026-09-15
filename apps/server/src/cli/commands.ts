import { execFile } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { splitPrompt, type AgentId, type Board, type BoardView, type Note } from "@kandy/core"
import { banner, berry, bold, dim, faint, heat, lemon, mint, sparkline, statusTag } from "./banner.js"
import { client, DEFAULT_PORT, ensureUp } from "./daemon.js"
import type { Reclaimable } from "../gc.js"
import { findReclaimable, heldBack, humanBytes, reclaim } from "../gc.js"

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
  const match = boards
    .filter((b) => cwd === b.repoPath || cwd.startsWith(b.repoPath + "/"))
    .sort((a, b) => b.repoPath.length - a.repoPath.length)[0]
  if (!match) return null
  return { board: match, view: await api.view(match.id) }
}

/**
 * Make a board for the repo we're standing in.
 *
 * The alternative is telling someone to go to the web UI to do a thing the CLI
 * could obviously do itself — and the repo is already unambiguous from cwd.
 */
async function adoptHere(port: number): Promise<{ board: Board; view: BoardView } | null> {
  const api = client(port)
  const check = await api.checkRepo(process.cwd())
  if (!check.isRepo) {
    out(berry("  not a git repository") + dim(` — ${process.cwd()}`))
    return null
  }
  const { board } = await api.createBoard(check.name ?? "board", check.path)
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

  const agent = opts.agent
  if (agent) await api.assignNote(noteId, agent)
  if (opts.run && agent) await api.runNote(noteId, agent)

  out(
    `  ${mint("✓")} ${bold(first)}` +
      (opts.run && agent ? dim(`  running with ${agent}`) : agent ? dim(`  assigned to ${agent}`) : ""),
  )
  out(dim(`    http://127.0.0.1:${opts.port}`))
  return 0
}

export async function cmdList(opts: { port: number; all: boolean }): Promise<number> {
  if (!(await ensureUp(opts.port))) return fail()
  const here = await boardHere(opts.port)
  if (!here) {
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
    out(`  ${statusTag(n.status).padEnd(22)} ${n.title}`)
    if (bits.length) out(`  ${" ".repeat(13)} ${bits.join(dim(" · "))}`)
  }
  out()
  return 0
}

export async function cmdStatus(opts: { port: number }): Promise<number> {
  const up = await ensureUp(opts.port)
  out(banner(up ? `running on :${opts.port}` : "not running"))
  if (!up) return 1

  const api = client(opts.port)
  const [{ boards }, { agents }] = await Promise.all([api.boards(), api.agents()])

  out(`  ${dim("repos")}`)
  for (const b of boards) out(`    ${bold(b.name)} ${dim(b.repoPath)}`)

  out()
  out(`  ${dim("agents")}`)
  for (const a of agents) {
    const state = !a.installed ? faint("not installed") : a.authed ? mint("ready") : lemon("signed out")
    out(`    ${a.id.padEnd(10)} ${state} ${dim(a.version ?? "")}`)
  }
  out()
  out(`  ${dim("board")}  http://127.0.0.1:${opts.port}`)
  out()
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
    `  ${bold(String(s.notes.total))} notes` +
      dim(" · ") +
      mint(`${s.notes.landed} landed`) +
      dim(" · ") +
      `${s.notes.discarded} discarded` +
      (s.notes.open ? dim(" · ") + lemon(`${s.notes.open} open`) : ""),
  )
  out(
    `  ${bold(usd(s.spend.usd, s.spend.estimated))}` +
      dim(` across ${s.runs.total} runs · ${s.spend.tokens.toLocaleString()} tokens`) +
      (s.spend.unpricedRuns ? dim(` · ${s.spend.unpricedRuns} unpriced`) : ""),
  )
  out()

  if (s.firstTry.of > 0) {
    const pct = Math.round((s.firstTry.landed / s.firstTry.of) * 100)
    row("landed first try", `${s.firstTry.landed} of ${s.firstTry.of}`, `${pct}%`)
  }
  if (s.code.insertions + s.code.deletions > 0) {
    row("code written", `${mint("+" + s.code.insertions)} ${berry("-" + s.code.deletions)}`,
      `${s.code.files} files`)
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
      `${s.busiestHour.runs} runs`,
    )
  if (s.tools[0]) row("most used tool", s.tools[0].tool, `${s.tools[0].calls} calls`)

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
    out(`  ${faint("      12 weeks")}${dim(" · ")}${faint(`busiest day ${max} runs`)}`)
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
          dim(` · ${a.discarded} discarded · ${a.runs} runs · `) +
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

  const found = await findReclaimable(here.board.repoPath, here.view.notes)
  if (found.length === 0) {
    if (stale.length === 0) out(dim("  nothing to reclaim — no worktrees left by finished notes"))
    return 0
  }

  out()
  // Colour codes make a string longer than it looks, so pad the plain label and
  // colour the result — otherwise the size column walks left and right.
  const VERB = 10
  const row = (verb: string, colour: (s: string) => string, item: Reclaimable, tail = "") =>
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

  out()
  out(
    `  ${bold(humanBytes(freed))} ${opts.dryRun ? "would be reclaimed" : "reclaimed"}` +
      dim(` · ${found.length - held} worktree${found.length - held === 1 ? "" : "s"}`) +
      (held ? dim(` · ${held} kept`) : ""),
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
  const source = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../.claude/skills/kandy/SKILL.md",
  )
  if (!existsSync(source)) {
    out(berry("  cannot find the skill to install") + dim(`\n  looked in ${source}`))
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
  const url = `http://127.0.0.1:${opts.port}`
  out(dim("  opening ") + url)
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  await exec(cmd, [url]).catch(() => out(dim(`  open ${url}`)))
  return 0
}

function byUrgency(notes: Note[]): Note[] {
  const order = ["blocked", "failed", "review", "running", "queued", "draft", "done"]
  return [...notes].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.updatedAt - a.updatedAt,
  )
}

function fail(): number {
  out(berry("  could not reach the kandy daemon"))
  out(dim(`  try: kandy serve --port ${DEFAULT_PORT}`))
  return 1
}
