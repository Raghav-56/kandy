import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  MAX_ATTACHMENTS,
  refuseAttachment,
  type Rejection,
  type StagedFile,
} from "@kandy/core"
import { STATE_DIR } from "./paths.js"

/**
 * Files handed to an agent.
 *
 * Two homes, because a note has two lives. Once it is running there is a
 * worktree, and a file written into it is a path the agent can open with the
 * tools it already has — no upload service, nothing to clean up, and it goes
 * when the worktree goes. Before it runs there is no worktree at all, so a file
 * attached while composing is *staged* in our own state dir, keyed by note id,
 * and moved into the worktree the moment one exists. We never write into the
 * user's repository for a note they have not run.
 */
const DIR = ".kandy-attachments"

/** Where staged attachments wait for a worktree. Outside the user's repo. */
const STAGE_ROOT = path.join(STATE_DIR, "attachments")

/**
 * Make the drop-off directory, and keep git out of it.
 *
 * The worktree is committed wholesale when the run ends (`git add -A`), so
 * without this a screenshot would ride the branch into the user's repository on
 * merge. A `.gitignore` of `*` inside the directory ignores its own contents
 * and itself — self-contained, and nothing in the user's repo config is
 * touched, which per-worktree excludes cannot promise.
 */
function dropDir(worktree: string): string {
  const dir = path.join(worktree, DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, ".gitignore"), "*\n")
  return dir
}

/** Names are user-supplied; keep the extension, discard everything else. */
function safeName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_")
  return base.replace(/^\.+/, "").slice(0, 120) || "attachment"
}

/**
 * A free name in `dir`.
 *
 * Every screenshot a browser puts on the clipboard is called `image.png`, so
 * attaching two of them used to mean attaching one of them twice.
 */
function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = name
  for (let n = 2; existsSync(path.join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`
  return candidate
}

export type Attachment = { name: string; relPath: string; bytes: number }

export function saveAttachments(
  worktree: string,
  files: { name: string; data: string }[],
): Attachment[] {
  const dir = dropDir(worktree)

  const saved: Attachment[] = []
  for (const f of files) {
    const name = uniqueName(dir, safeName(f.name))
    // The client sends base64 so the payload is plain JSON; no multipart parser
    // for a feature that is mostly one screenshot at a time.
    const buf = Buffer.from(f.data, "base64")
    const target = path.join(dir, name)
    // basename() already flattens traversal, but assert it rather than trust it.
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) continue
    writeFileSync(target, buf)
    saved.push({ name, relPath: path.join(DIR, name), bytes: buf.byteLength })
  }
  return saved
}

/**
 * Apply the size and content rules before anything is written.
 *
 * The same rule wherever a file arrives — with a worktree or without one —
 * because "kandy took my screenshot yesterday and not today" is a worse bug
 * than either answer on its own.
 */
export function screen(files: { name: string; data: string }[]): {
  accepted: { name: string; data: string }[]
  rejected: Rejection[]
} {
  const accepted: { name: string; data: string }[] = []
  const rejected: Rejection[] = []
  for (const f of files) {
    const reason = refuseAttachment(f.name, Buffer.from(f.data, "base64"))
    if (reason) rejected.push({ name: f.name, reason })
    else accepted.push(f)
  }
  return { accepted, rejected }
}

/** Tell the agent what it was given, in the message itself. */
export function describe(files: Attachment[]): string {
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.relPath} (${Math.ceil(f.bytes / 1024)} KB)`)
  return `\n\nAttached ${files.length === 1 ? "file" : "files"}, relative to the repo root:\n${lines.join("\n")}`
}

// ---------------------------------------------------------------------------
// Staging — attachments for a note that has no worktree yet.
// ---------------------------------------------------------------------------

export type { Rejection, StagedFile } from "@kandy/core"

/** Note ids come off a URL. Never build a path from one we did not mint. */
function stageDir(noteId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(noteId)) throw new Error(`bad note id ${noteId}`)
  return path.join(STAGE_ROOT, noteId)
}

/**
 * Hold files for a note that has no worktree yet.
 *
 * On disk, so they survive a page reload — and a daemon restart — between
 * writing the note and running it.
 */
export function stageAttachments(
  noteId: string,
  files: { name: string; data: string }[],
): { staged: StagedFile[]; rejected: Rejection[] } {
  const dir = stageDir(noteId)
  mkdirSync(dir, { recursive: true })

  const staged: StagedFile[] = []
  const rejected: Rejection[] = []
  let count = readdirSync(dir).length

  const screened = screen(files)
  rejected.push(...screened.rejected)

  for (const f of screened.accepted) {
    const name = uniqueName(dir, safeName(f.name))
    const buf = Buffer.from(f.data, "base64")

    if (count >= MAX_ATTACHMENTS) {
      rejected.push({ name: f.name, reason: `at most ${MAX_ATTACHMENTS} files per note` })
      continue
    }

    const target = path.join(dir, name)
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) continue
    writeFileSync(target, buf)
    count++
    staged.push({ name, bytes: buf.byteLength })
  }
  return { staged, rejected }
}

/** What is waiting for this note's worktree. Empty for a note with nothing. */
export function stagedFor(noteId: string): StagedFile[] {
  const dir = stageDir(noteId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => ({ name, bytes: statSync(path.join(dir, name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Take one back off before running. */
export function unstageAttachment(noteId: string, name: string): boolean {
  const dir = stageDir(noteId)
  const target = path.join(dir, safeName(name))
  if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) return false
  if (!existsSync(target)) return false
  rmSync(target)
  return true
}

/** A deleted or decided note keeps nothing. */
export function clearStaged(noteId: string): void {
  rmSync(stageDir(noteId), { recursive: true, force: true })
}

/**
 * Move everything staged for this note into its worktree, now that it has one.
 *
 * A move, not a copy: the second run of the same note reuses the same worktree,
 * where the files already are, so re-listing them in every follow-up prompt
 * would just be noise.
 */
export function adoptStaged(noteId: string, worktree: string): Attachment[] {
  const dir = stageDir(noteId)
  if (!existsSync(dir)) return []

  const names = readdirSync(dir)
  // Nothing staged means nothing to do — and, deliberately, no drop directory
  // in a worktree whose note never had an attachment.
  if (names.length === 0) return []

  const adopted: Attachment[] = []
  const into = dropDir(worktree)

  for (const name of names) {
    // A note can have been steered with a file of the same name before it ran.
    const landed = uniqueName(into, name)
    const to = path.join(into, landed)
    copyFileSync(path.join(dir, name), to)
    adopted.push({ name: landed, relPath: path.join(DIR, landed), bytes: statSync(to).size })
  }
  // Only after every copy landed. A throw above leaves the stage intact, so the
  // next attempt still has the files.
  rmSync(dir, { recursive: true, force: true })
  return adopted.sort((a, b) => a.name.localeCompare(b.name))
}
