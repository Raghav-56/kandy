import type { ActivityFrame, KandyEvent, TranscriptFrame } from "@kandy/core"
import { berry, bold, dim, faint, lemon, mint, sky } from "./banner.js"
import { boardHere } from "./commands.js"
import { client, ensureUp } from "./daemon.js"

const out = (s = "") => process.stdout.write(s + "\n")

/** Wall clock, seconds resolution — enough to line a log up against a shell. */
function clock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat
}

/**
 * Colour by family, so a scrolling log has a shape.
 *
 * The label is always the reducer's own event name. Inventing friendlier words
 * here would mean two vocabularies for the same log — and the one in the code
 * is the one you can grep for.
 */
function paint(type: string, label: string): string {
  if (type === "run.blocked" || type === "note.deleted" || type === "board.removed") {
    return berry(label)
  }
  if (type.startsWith("review.")) return mint(label)
  if (type.startsWith("run.")) return lemon(label)
  if (type.startsWith("note.")) return sky(label)
  return faint(label)
}

/** The part of an event that isn't its name: what actually changed. */
function detailOf(e: KandyEvent, columns: ReadonlyMap<string, string> = new Map()): string {
  switch (e.type) {
    case "note.moved":
      // Where to, by name: a column id says nothing to a person.
      return columns.get(e.data.columnId) ?? ""
    case "board.created":
      return `${e.data.name} · ${e.data.repoPath}`
    case "column.created":
      return e.data.name
    case "note.edited":
      return e.data.title !== undefined ? "title" : "body"
    case "note.assigned":
      return e.data.agent
    case "note.model":
      return e.data.model ?? "board default"
    case "note.policy":
      return e.data.policy
    case "board.policy":
      return `new notes: ${e.data.defaultPolicy}`
    case "note.status":
      return e.data.status
    case "note.pr":
      return e.data.pr ? `#${e.data.pr.number} ${e.data.pr.state}` : "cleared"
    case "run.requested":
      return e.data.agent
    case "run.started":
      return `${e.data.branch} · pid ${e.data.pid}`
    case "run.tool":
      return `${e.data.tool} ${e.data.status}`
    case "run.blocked":
      return `${e.data.kind}: ${clip(e.data.detail, 60)}`
    case "run.unblocked":
      return e.data.decision
    case "run.quiet":
      return e.data.since === null ? "talking again" : "no output"
    case "run.finished":
      return e.data.status + (e.data.error ? ` · ${clip(e.data.error, 60)}` : "")
    case "run.metrics":
      return [
        e.data.costUsd !== null ? `$${e.data.costUsd.toFixed(2)}` : "",
        e.data.tokens !== null ? `${e.data.tokens.toLocaleString()} tok` : "",
        e.data.model ?? "",
      ]
        .filter(Boolean)
        .join(" · ")
    case "review.opened": {
      const s = e.data.stat
      return `+${s.insertions} -${s.deletions} · ${s.files} ${s.files === 1 ? "file" : "files"}`
    }
    case "review.decided":
      return e.data.decision
    default:
      return ""
  }
}

/**
 * Tail the board for the repo we're standing in.
 *
 * Starts from the view's current sequence rather than replaying the log: this
 * is a tail, and a board with a thousand events behind it should not spend the
 * first screen on history nobody asked for.
 */
export async function cmdLog(opts: { port: number; verbose: boolean }): Promise<number> {
  // ensureUp says why when it can't.
  if (!(await ensureUp(opts.port))) return 1

  const api = client(opts.port)
  const here = await boardHere(opts.port)
  if (!here) {
    out(dim("  no board for this repo yet — ") + `kandy new "…"` + dim(" will make one"))
    return 0
  }
  const { board, view } = here

  // Events name a note by id, and a log that prints ids is a log you have to
  // decode. Seed the names from the view and keep them current from the log
  // itself, so a note created while we watch is named on its very first line.
  const titles = new Map<string, string>()
  for (const n of view.notes) titles.set(n.id, n.title)
  const columns = new Map<string, string>()
  for (const c of view.columns) columns.set(c.id, c.name)
  const noteOfRun = new Map<string, string>()
  for (const r of view.runs) noteOfRun.set(r.id, r.noteId)

  const nameOf = (noteId: string | undefined): string =>
    noteId ? (titles.get(noteId) ?? noteId) : ""

  out()
  out(`  ${bold(board.name)} ${dim(board.repoPath)}`)
  out(`  ${faint("watching · ctrl-c to stop")}`)
  out()

  const line = (ts: number, type: string, title: string, detail: string) => {
    // Pad before colouring: escape codes have width zero to a terminal and
    // width six to padEnd, which is how columns end up ragged.
    const head = `  ${faint(clock(ts))}  ${paint(type, type.padEnd(14))}`
    if (!detail) return out(`${head}  ${clip(title, 34)}`)
    out(`${head}  ${clip(title, 34).padEnd(34)} ${dim(detail)}`)
  }

  // The polyfilled EventSource retries once a second, and a daemon that is
  // down for a minute would otherwise print sixty identical lines. Say it once
  // per outage, and say when it comes back.
  let live = true
  let seen = view.seq

  const onEvent = (e: KandyEvent) => {
    if (!live) {
      live = true
      process.stderr.write(dim("  reconnected\n"))
    }
    // A reconnect resumes from Last-Event-ID, which can hand back an event we
    // already printed. A log that repeats itself after a blip is a log you
    // stop trusting.
    if (e.seq <= seen) return
    seen = e.seq

    // `run.session` records the agent's session id, which can land several
    // times a second. Steering depends on it; a human watching does not. It is
    // bookkeeping, not news.
    if (e.type === "run.session" && !opts.verbose) return

    // `in` rather than a cast: the payloads are a discriminated union, and the
    // compiler can tell us which of them actually name a board, note or run.
    const boardId = "boardId" in e.data ? e.data.boardId : undefined
    const runId = "runId" in e.data ? e.data.runId : undefined

    // Learn the mappings before deciding whether this event is ours, so a note
    // created on this board is recognised by every event that follows it.
    if (e.type === "note.created") {
      if (e.data.boardId !== board.id) return
      titles.set(e.data.noteId, e.data.title)
    }
    if (e.type === "note.edited" && e.data.title !== undefined && titles.has(e.data.noteId)) {
      titles.set(e.data.noteId, e.data.title)
    }
    if (e.type === "run.requested" || e.type === "run.started" || e.type === "run.finished") {
      noteOfRun.set(e.data.runId, e.data.noteId)
    }

    // Scope to this board. A note or run we've never heard of belongs to
    // another repo's board, and printing it here would be a lie about what
    // this log is watching.
    const noteId =
      ("noteId" in e.data ? e.data.noteId : undefined) ??
      (runId ? noteOfRun.get(runId) : undefined)
    if (boardId !== undefined) {
      if (boardId !== board.id) return
    } else if (!noteId || !titles.has(noteId)) {
      return
    }

    if (e.type === "column.created") columns.set(e.data.columnId, e.data.name)
    line(e.ts, e.type, nameOf(noteId), detailOf(e, columns))

    // Keep the deletion legible, then forget the note.
    if (e.type === "note.deleted") titles.delete(e.data.noteId)
  }

  const ephemeral = (f: TranscriptFrame | ActivityFrame) => {
    const noteId = noteOfRun.get(f.runId)
    if (!noteId || !titles.has(noteId)) return
    const detail =
      f.kind === "transcript" ? `${f.role}: ${clip(f.text, 70)}` : `${f.tool} ${clip(f.detail, 50)}`
    line(f.ts, f.kind, nameOf(noteId), detail)
  }

  const stop = api.events(view.seq, {
    onEvent,
    // Transcript and activity are the agent thinking out loud: thousands of
    // frames per run, and noise against the domain log this command exists to
    // show. They are there when you ask for them.
    ...(opts.verbose ? { onTranscript: ephemeral, onActivity: ephemeral } : {}),
    onError: () => {
      if (!live) return
      live = false
      process.stderr.write(dim("  stream dropped — reconnecting…\n"))
    },
  })

  return await new Promise<number>((resolve) => {
    const bye = () => {
      stop()
      out(dim("\n  stopped watching\n"))
      resolve(0)
    }
    process.on("SIGINT", bye)
    process.on("SIGTERM", bye)
  })
}
