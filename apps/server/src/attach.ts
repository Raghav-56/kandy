import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * Files handed to an agent mid-conversation.
 *
 * Written into the note's own worktree rather than a shared store, because the
 * agent is already running there — it can open the path we give it with the
 * tools it already has, and the file is discarded with the worktree when the
 * note is reviewed. No new capability, no upload service, nothing to clean up.
 */
const DIR = ".kandy-attachments"

/** Names are user-supplied; keep the extension, discard everything else. */
function safeName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_")
  return base.replace(/^\.+/, "").slice(0, 120) || "attachment"
}

export type Attachment = { name: string; relPath: string; bytes: number }

export function saveAttachments(
  worktree: string,
  files: { name: string; data: string }[],
): Attachment[] {
  const dir = path.join(worktree, DIR)
  mkdirSync(dir, { recursive: true })

  const saved: Attachment[] = []
  for (const f of files) {
    const name = safeName(f.name)
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

/** Tell the agent what it was given, in the message itself. */
export function describe(files: Attachment[]): string {
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.relPath} (${Math.ceil(f.bytes / 1024)} KB)`)
  return `\n\nAttached ${files.length === 1 ? "file" : "files"}, relative to the repo root:\n${lines.join("\n")}`
}
