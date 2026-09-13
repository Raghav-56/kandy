/**
 * SPIKE — sharing a board over a git orphan branch.
 *
 * Not shipped, not wired into the daemon. This exists to answer one question
 * from docs/11-going-multiplayer.md: does the merge story hold when two
 * laptops hand a note back and forth over nothing but a git remote?
 *
 * Findings live in docs/12-spike-git-share.md. Read that before extending
 * this — several of the shapes here are deliberate answers to things that
 * only showed up once two stores were talking to each other.
 *
 * Layout on the branch (orphan, flat, one file per device):
 *
 *   <deviceId>.jsonl   append-only; only its owning device ever writes it
 *   README             so a human who stumbles onto the branch knows what it is
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import {
  event,
  id,
  type BoardView,
  type KandyEvent,
  type KandyEventType,
  type Lane,
  type PendingEvent,
} from "@kandy/core"
import type { Engine } from "./engine.js"
import { STATE_DIR } from "./paths.js"

const exec = promisify(execFile)

export const SHARE_BRANCH = "kandy-log"
/** Where a fetched copy of the branch lives locally. Deliberately outside
 *  refs/heads so it never shows up in `git branch` or a branch picker. */
const LOCAL_REF = "refs/kandy/log"

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

async function gitIn(cwd: string, input: string, ...args: string[]): Promise<string> {
  const child = exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  child.child.stdin?.end(input)
  return (await child).stdout.trim()
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * This install's device id. Stable across restarts, one per machine.
 *
 * It names a *file on the branch*, not a person — that is what makes writes
 * disjoint and therefore unmergeable-by-accident.
 */
export function deviceId(stateDir: string = STATE_DIR): string {
  const file = path.join(stateDir, "device")
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim()
    if (saved) return saved
  }
  const fresh = id("dev")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, fresh + "\n")
  return fresh
}

/**
 * A board key both laptops agree on without talking first.
 *
 * `boardId` cannot be it: each install mints its own when it adopts the repo,
 * so the same repository is `board_…a` here and `board_…b` there. The root
 * commit is the one identifier that is already identical in every clone.
 */
export async function repoKey(repoPath: string): Promise<string> {
  const roots = await git(repoPath, "rev-list", "--max-parents=0", "HEAD")
  // A repo with grafted or multiple roots still gives a stable answer as long
  // as we always take the same one.
  return roots.split("\n").map((s) => s.trim()).filter(Boolean).sort()[0] ?? "unknown"
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export type ShareRecord = {
  v: 1
  /** Root commit of the repo — which board this belongs to, portably. */
  repo: string
  /** Device that authored the event. */
  origin: string
  /** That device's local seq. (origin, oseq) is the event's global identity. */
  oseq: number
  ts: number
  type: KandyEventType
  data: Record<string, unknown>
}

/**
 * Event types that survive the trip.
 *
 * `board.created` and `column.created` are deliberately absent: they describe
 * *this install's* identifiers and its checkout path. A teammate already has
 * their own board and their own lanes, so those events are re-derived locally
 * rather than replicated. `run.output` and `run.tool` are out for the reason
 * they are already out of the domain log — volume.
 */
const SHAREABLE: ReadonlySet<string> = new Set<KandyEventType>([
  "note.created",
  "note.edited",
  "note.moved",
  "note.assigned",
  "note.model",
  "note.policy",
  "note.status",
  "note.deleted",
  "note.pr",
  "run.requested",
  "run.started",
  "run.session",
  "run.metrics",
  "run.finished",
  "review.opened",
  "review.decided",
])

/** Fields that describe this machine and are wrong, not merely missing, elsewhere. */
const MACHINE_LOCAL = ["worktree", "pid", "repoPath"] as const

/**
 * Strip an event down to what is true on any machine.
 *
 * Two rewrites matter:
 *  - `boardId`/`columnId` are per-install randoms. The board id is dropped
 *    (the file's `repo` key replaces it) and the column is carried as its
 *    *lane*, which is semantic and therefore portable.
 *  - `worktree` and `pid` are stripped outright. A path under my
 *    /Users/… means nothing on your laptop, and a pid there is someone else's
 *    process.
 */
export function portable(e: KandyEvent, view: BoardView): Record<string, unknown> | null {
  if (!SHAREABLE.has(e.type)) return null
  const data: Record<string, unknown> = { ...(e.data as Record<string, unknown>) }
  delete data["boardId"]
  for (const k of MACHINE_LOCAL) delete data[k]

  if (typeof data["columnId"] === "string") {
    const col = view.columns.find((c) => c.id === data["columnId"])
    delete data["columnId"]
    // A column with no declared lane is a user-made one; it has no counterpart
    // on the other machine, so the note lands in the lane its status implies.
    if (col?.lane) data["lane"] = col.lane
  }
  return data
}

/** Put a foreign event back into this install's own identifiers. */
export function localise(
  rec: ShareRecord,
  view: BoardView,
): PendingEvent | null {
  if (!SHAREABLE.has(rec.type)) return null
  const data: Record<string, unknown> = { ...rec.data }

  const lane = data["lane"] as Lane | undefined
  delete data["lane"]
  if (rec.type === "note.created" || rec.type === "note.moved") {
    // A move into a column the author invented has no counterpart here. Drop
    // it rather than guess: a note silently teleporting to Inbox is a worse
    // lie than a move that didn't replicate.
    const col = lane
      ? view.columns.find((c) => c.lane === lane)
      : rec.type === "note.created"
        ? (view.columns.find((c) => c.lane === "inbox") ?? view.columns[0])
        : undefined
    if (!col) return null
    data["columnId"] = col.id
  }
  if (rec.type === "note.created") data["boardId"] = view.board.id

  // The reducer writes these onto the note, so they have to be *something*.
  // Empty is honest: the run happened, but not here.
  if (rec.type === "run.started") {
    data["worktree"] = ""
    data["pid"] = 0
  }
  return event(rec.type as never, data as never)
}

/** Whether an event concerns this board at all. */
function belongsTo(view: BoardView, e: KandyEvent): boolean {
  const d = e.data as Record<string, unknown>
  if (typeof d["boardId"] === "string") return d["boardId"] === view.board.id
  if (typeof d["noteId"] === "string") return view.notes.some((n) => n.id === d["noteId"])
  if (typeof d["runId"] === "string") return view.runs.some((r) => r.id === d["runId"])
  return false
}

/** This device's shareable events for one board, oldest first. */
export function exportable(
  engine: Engine,
  view: BoardView,
  device: string,
  repo: string,
  after = 0,
): ShareRecord[] {
  const out: ShareRecord[] = []
  for (const e of engine.store.locallyAuthored(after)) {
    if (!belongsTo(view, e)) continue
    const data = portable(e, view)
    if (!data) continue
    out.push({ v: 1, repo, origin: device, oseq: e.seq, ts: e.ts, type: e.type, data })
  }
  return out
}

/**
 * Fold a teammate's records into the local board.
 *
 * Applied in the order they appear in their file, which is that device's own
 * causal order. Across devices we do not attempt a total order — see the
 * "Ordering" finding in docs/12-spike-git-share.md.
 */
export function foldInto(
  engine: Engine,
  view: BoardView,
  records: readonly ShareRecord[],
): { applied: number; skipped: number } {
  let applied = 0
  let skipped = 0
  for (const rec of records) {
    if (engine.store.isShared(rec.origin, rec.oseq)) {
      skipped++
      continue
    }
    const current = engine.view(view.board.id) ?? view
    const pending = localise(rec, current)
    if (!pending) {
      skipped++
      continue
    }
    const e = engine.store.appendShared(pending, rec.origin, rec.oseq, rec.ts)
    if (!e) {
      skipped++
      continue
    }
    engine.projections.apply(e)
    engine.bus.publish(e)
    applied++
  }
  return { applied, skipped }
}

export function encode(records: readonly ShareRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "")
}

export function decode(text: string): ShareRecord[] {
  const out: ShareRecord[] = []
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t) as ShareRecord
      if (rec && rec.v === 1 && typeof rec.origin === "string") out.push(rec)
    } catch {
      // A half-written line is the one thing append-only JSONL can produce on
      // a crash. Skipping it loses one event; refusing the file loses all of
      // them.
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

/**
 * Read the branch's files without checking anything out.
 *
 * Plumbing rather than a worktree on purpose: the user is working in this
 * repo. A sync that switches their branch, or leaves a stray checkout in their
 * tree, is worse than no sync.
 */
export async function fetchLog(
  repoPath: string,
  remote: string,
): Promise<Map<string, ShareRecord[]>> {
  await git(repoPath, "fetch", remote, `+refs/heads/${SHARE_BRANCH}:${LOCAL_REF}`).catch(() => {
    // No branch on the remote yet. An empty board is the right answer.
  })
  const files = new Map<string, ShareRecord[]>()
  const tree = await git(repoPath, "ls-tree", LOCAL_REF).catch(() => "")
  for (const line of tree.split("\n")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line.trim())
    if (!m) continue
    const [, sha, name] = m
    if (!name!.endsWith(".jsonl")) continue
    const blob = await git(repoPath, "cat-file", "blob", sha!)
    files.set(name!.replace(/\.jsonl$/, ""), decode(blob))
  }
  return files
}

/**
 * Replace this device's file on the branch and push.
 *
 * Note what is *not* here: a merge. We fetch the remote tree, swap in one blob
 * — ours, the only one we are allowed to write — and commit that. A concurrent
 * push by another device makes our ref stale, and the retry rebuilds against
 * their tree. There is no content conflict to resolve because no two devices
 * ever write the same path.
 */
export async function pushLog(
  repoPath: string,
  remote: string,
  device: string,
  records: readonly ShareRecord[],
  attempts = 3,
): Promise<{ pushed: number; commit: string }> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await git(repoPath, "fetch", remote, `+refs/heads/${SHARE_BRANCH}:${LOCAL_REF}`).catch(() => {})
    const parent = await git(repoPath, "rev-parse", LOCAL_REF).catch(() => "")

    const entries: string[] = []
    let mine = ""
    const tree = parent ? await git(repoPath, "ls-tree", LOCAL_REF) : ""
    for (const line of tree.split("\n")) {
      const m = /^(\d+) (blob|tree) ([0-9a-f]+)\t(.+)$/.exec(line.trim())
      if (!m) continue
      const [, mode, kind, sha, name] = m
      if (name === `${device}.jsonl`) {
        mine = await git(repoPath, "cat-file", "blob", sha!)
        continue
      }
      entries.push(`${mode} ${kind} ${sha}\t${name}`)
    }

    // Only append what our file does not already carry. This is what makes
    // `share push` idempotent without any local "last pushed" bookkeeping —
    // the branch itself is the watermark.
    const have = new Set(decode(mine).map((r) => r.oseq))
    const fresh = records.filter((r) => !have.has(r.oseq))
    if (fresh.length === 0 && parent) return { pushed: 0, commit: parent }

    const body = (mine.endsWith("\n") || !mine ? mine : mine + "\n") + encode(fresh)
    const blob = await gitIn(repoPath, body, "hash-object", "-w", "--stdin")
    entries.push(`100644 blob ${blob}\t${device}.jsonl`)

    if (!entries.some((e) => e.endsWith("\tREADME"))) {
      const readme = await gitIn(
        repoPath,
        "kandy shares a board as one append-only JSONL file per device.\n" +
          "Nothing here is source. See docs/12-spike-git-share.md.\n",
        "hash-object",
        "-w",
        "--stdin",
      )
      entries.push(`100644 blob ${readme}\tREADME`)
    }

    const treeSha = await gitIn(repoPath, entries.join("\n") + "\n", "mktree")
    const commit = await gitIn(
      repoPath,
      `kandy: ${fresh.length} event(s) from ${device}`,
      "commit-tree",
      treeSha,
      ...(parent ? ["-p", parent] : []),
    )
    await git(repoPath, "update-ref", LOCAL_REF, commit)

    try {
      await git(repoPath, "push", remote, `${LOCAL_REF}:refs/heads/${SHARE_BRANCH}`)
      return { pushed: fresh.length, commit }
    } catch (err) {
      // Rejected: someone pushed between our fetch and our push. Rebuild
      // against what they left. Nothing to merge, so this always converges.
      if (attempt === attempts - 1) throw err
    }
  }
  throw new Error("push did not settle")
}
