import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentId, Board, BoardView, Note } from "@kandy/core"
import { banner, berry, bold, dim, faint, lemon, mint, statusTag } from "./banner.js"
import { client, DEFAULT_PORT, ensureUp } from "./daemon.js"

const exec = promisify(execFile)
const out = (s = "") => process.stdout.write(s + "\n")

/** The board whose repo contains the current directory. */
async function boardHere(port: number): Promise<{ board: Board; view: BoardView } | null> {
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

  // First line is the title, the rest is the prompt — same rule as the web
  // composer, so a note reads the same wherever it was written.
  const [first = "", ...rest] = title.split("\n")
  const { noteId } = await api.createNote(here.board.id, column, first.trim(), rest.join("\n").trim())

  const agent = opts.agent
  if (agent) await api.assignNote(noteId, agent)
  if (opts.run && agent) await api.runNote(noteId, agent)

  out(
    `  ${mint("✓")} ${bold(first.trim())}` +
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
