import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import type { DiffStat } from "@kandy/core"
import { withTrailers } from "./attribution.js"
import { composeCommitMessage, type CommitFacts, type CommitNote } from "./message.js"
import { worktreeRoot } from "./paths.js"

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

/** Output bigger than `git`'s buffer. The command worked; we just can't hold it. */
function tooBig(err: unknown): boolean {
  return (err as { code?: unknown })?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
}

/**
 * Where git keeps one of its own files for this checkout.
 *
 * Asked of git rather than assumed to be `.git/<name>`: in a linked worktree
 * or a submodule `.git` is a file pointing elsewhere, and the path it implies
 * does not exist. Relative answers are relative to `cwd`.
 */
async function gitPath(cwd: string, name: string): Promise<string> {
  return path.resolve(cwd, await git(cwd, "rev-parse", "--git-path", name))
}

/** The message for a repository with nothing to branch from. */
export const NO_COMMITS = "this repository has no commits yet — make a first commit, then try again"

/**
 * Our worktree directory lives inside the repo so git can share the object
 * store. That makes the repo dirty, which would trip the repo_dirty guard on
 * every run after the first.
 *
 * Exclude it via info/exclude rather than the tracked .gitignore — it is our
 * bookkeeping, not something to commit into the user's project. The file is
 * found through git, and made if it is missing: a repo cloned without
 * templates has no info/exclude, and a linked worktree's lives in the main
 * repository's git directory.
 */
async function ensureExcluded(repoPath: string): Promise<void> {
  const entry = "/.kandy/"
  try {
    const exclude = await gitPath(repoPath, "info/exclude")
    mkdirSync(path.dirname(exclude), { recursive: true })
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : ""
    if (current.split("\n").some((l) => l.trim() === entry)) return
    appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}# added by kandy\n${entry}\n`)
  } catch {
    // Not fatal — the user will see .kandy/ as untracked, which is ugly but
    // not wrong.
  }
}

export type Worktree = {
  path: string
  branch: string
  /** The commit the note branched from. Pinned so a queued note doesn't drift. */
  baseRef: string
  /**
   * The branch it will land on, e.g. "main".
   *
   * Diffs are taken against this rather than `baseRef`, because the two answer
   * different questions. `baseRef` is "where did this agent start", which must
   * stay pinned. "What did this note change" has to be asked against the live
   * base branch: once main is merged INTO the note's branch, a diff from the
   * pinned commit counts main's own work as the note's. That is how a note
   * that added 132 lines came to report 2,496.
   */
  baseBranch: string | null
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "note"
  )
}

/**
 * The load-bearing piece. Every note runs in its own checkout on its own
 * branch, so N agents can work the same repo without seeing each other's
 * writes — and so the user's actual working tree is never touched.
 */
export async function createWorktree(
  repoPath: string,
  noteId: string,
  title: string,
): Promise<Worktree> {
  // Resolve the base commit now and record it. A note queued at 2pm must not
  // silently rebase onto whatever main looks like when a slot frees up.
  // A repository with no commits has no HEAD to branch from, and git says so
  // as "ambiguous argument 'HEAD'" — true, and no help to anyone.
  const baseRef = await git(repoPath, "rev-parse", "--verify", "--quiet", "HEAD^{commit}").catch(() => "")
  if (!baseRef) throw new Error(NO_COMMITS)
  // Detached HEAD has no branch to land on; fall back to the pinned commit.
  const baseBranch = await git(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
    .then((b) => (b && b !== "HEAD" ? b : null))
    .catch(() => null)

  await ensureExcluded(repoPath)
  const root = worktreeRoot(repoPath)
  mkdirSync(root, { recursive: true })

  const dir = path.join(root, noteId)
  const branch = `kandy/${noteId}-${slug(title)}`

  await git(repoPath, "worktree", "add", "-b", branch, dir, baseRef)
  return { path: dir, branch, baseRef, baseBranch }
}

/**
 * Agents are inconsistent about committing. Capture whatever they left.
 *
 * `trailers` is empty unless the board asked for attribution, and an empty
 * list must produce exactly the command this issued before trailers existed —
 * no `--trailer` flags at all. `git commit --trailer` (git ≥ 2.32) does the
 * formatting: blank line after the subject, one trailer per line, readable
 * back with `git log --format='%(trailers:key=Kandy-Note,valueonly)'`.
 */
export async function commitLeftovers(
  wt: Worktree,
  message: string,
  trailers: readonly string[] = [],
): Promise<boolean> {
  const status = await git(wt.path, "status", "--porcelain")
  if (!status) return false
  await git(wt.path, "add", "-A")
  await git(
    wt.path,
    "commit",
    "-m",
    message,
    ...trailers.flatMap((t) => ["--trailer", t]),
    "--no-verify",
  )
  return true
}

/**
 * What to diff against: the branch this note lands on, falling back to the
 * commit it started from. See Worktree.baseBranch for why these differ.
 */
function against(wt: Worktree): string {
  return `${wt.baseBranch ?? wt.baseRef}...HEAD`
}

export async function diffStat(wt: Worktree): Promise<string> {
  return git(wt.path, "diff", "--stat", against(wt)).catch(async (err: unknown) => {
    if (!tooBig(err)) throw err
    return git(wt.path, "diff", "--shortstat", against(wt))
  })
}

/**
 * Structured diff size, so the UI can draw a bar instead of printing a
 * sentence. Parsed from --shortstat, e.g.
 *   " 2 files changed, 105 insertions(+), 1 deletion(-)"
 */
export async function diffNumbers(wt: Worktree): Promise<DiffStat> {
  const line = await git(wt.path, "diff", "--shortstat", against(wt))
    // A base branch that no longer exists shouldn't lose the diff entirely.
    .catch(() => git(wt.path, "diff", "--shortstat", `${wt.baseRef}...HEAD`).catch(() => ""))
  const num = (re: RegExp) => Number(line.match(re)?.[1] ?? 0)
  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  }
}

/**
 * The whole diff, or a stand-in saying it is too big to show.
 *
 * A diff past the buffer used to reject, and the run that asked for it
 * recorded nothing at all — so the biggest change an agent ever made arrived
 * in review as "0 files changed". The stand-in is shaped like a one-file diff
 * so every viewer draws it as a row, and it says where to read the real one.
 */
export async function diff(wt: Worktree): Promise<string> {
  const range = against(wt)
  try {
    return await git(wt.path, "diff", range).catch((err: unknown) => {
      if (tooBig(err)) throw err
      return git(wt.path, "diff", `${wt.baseRef}...HEAD`)
    })
  } catch (err) {
    if (!tooBig(err)) throw err
    const { files } = await diffNumbers(wt)
    const title = `diff too large to show (${files.toLocaleString("en-US")} ${files === 1 ? "file" : "files"} changed)`
    return [
      `diff --git a/${title} b/${title}`,
      "@@ too large to show @@",
      ` Read it with git in the note's worktree: git diff ${range}`,
    ].join("\n")
  }
}

export async function removeWorktree(repoPath: string, dir: string, force = false): Promise<void> {
  await git(repoPath, "worktree", "remove", ...(force ? ["--force"] : []), dir)
}

/**
 * Land a note's branch on the base branch it came from.
 *
 * Merged with --no-ff so a note is always one identifiable thing in history —
 * "what did kandy do here" stays answerable a month later. A conflict is
 * reported rather than resolved; the user has a worktree and an editor, and
 * guessing at a merge on their behalf is how trust dies.
 *
 * `git merge` has no `--trailer` of its own, so trailers are folded into the
 * message here. With none, the message is exactly what composeCommitMessage
 * produced.
 *
 * The message is the note's own words rather than its branch name — see
 * composeCommitMessage. The note is required for that reason: a merge commit
 * is the one commit that survives the branch being deleted, so it is the last
 * place that can still say what the work was.
 *
 * The merge happens in the user's own checkout, so before touching it this
 * checks that it is fit to merge into, and refuses — changing nothing — when
 * it is not:
 *
 * - It must be on `into`, the branch the note was started from and the one
 *   the confirmation named. Merging into whatever happens to be checked out
 *   put a teammate's note on someone's personal branch, and on a detached
 *   HEAD it made a commit no branch pointed at. Switching branches for them
 *   is not ours to do either: their checkout is theirs.
 * - It must not be halfway through a merge, rebase, cherry-pick or revert of
 *   its own. A failed merge is undone with `git merge --abort`, and that
 *   must only ever undo a merge this started.
 *
 * `reason` is written to be read in a one-line status bar: what happened
 * first, then what to do.
 */
export async function mergeBranch(
  repoPath: string,
  branch: string,
  land: { note: CommitNote; facts?: CommitFacts; trailers?: readonly string[] },
  into: string | null = null,
): Promise<Merge> {
  const busy = await midOperation(repoPath)
  if (busy) {
    return refused("busy", `your checkout is in the middle of a ${busy} — finish or abort it, then merge again`)
  }

  const current = await git(repoPath, "symbolic-ref", "--quiet", "--short", "HEAD").catch(() => "")
  if (!current) {
    return refused(
      "elsewhere",
      `your checkout is on a detached HEAD — check out ${into ?? "the branch to merge into"}, then merge again`,
    )
  }
  if (into && current !== into) {
    return refused(
      "elsewhere",
      `your checkout is on ${current}, not ${into} — switch it to ${into}, then merge again`,
    )
  }

  // A branch whose every commit is already on `current` would "merge" as a
  // no-op, and the note would be counted as landed work.
  const ahead = Number(await git(repoPath, "rev-list", "--count", `${current}..${branch}`).catch(() => "0"))
  if (!ahead) {
    return refused("empty", `nothing to merge — ${branch} has no commits that ${current} does not have`)
  }

  const message = withTrailers(composeCommitMessage(land.note, land.facts), land.trailers ?? [])
  try {
    await git(repoPath, "merge", "--no-ff", "-m", message, branch)
    return { merged: true }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    // Only a merge this started can have left MERGE_HEAD: there was none a
    // moment ago, or it would have been refused above.
    if (existsSync(await gitPath(repoPath, "MERGE_HEAD"))) {
      const files = (await git(repoPath, "diff", "--name-only", "--diff-filter=U").catch(() => ""))
        .split("\n")
        .filter(Boolean)
      // Leave the repo clean rather than parked in a half-merge the user has
      // to discover on their own.
      await git(repoPath, "merge", "--abort").catch(() => {})
      return refused(
        "conflict",
        `merge conflict in ${listFiles(files)} — nothing was merged and ${branch} is intact. ` +
          `Send it back asking the agent to merge ${current} and resolve the conflict, or merge it yourself`,
        files,
      )
    }

    // Refused before it began: the user's own uncommitted files are in the way.
    const output = `${e.stderr ?? ""}\n${e.stdout ?? ""}`
    if (/would be overwritten by merge/.test(output)) {
      const files = output
        .split("\n")
        .filter((l) => /^\t\S/.test(l))
        .map((l) => l.trim())
      return refused(
        "dirty",
        `your uncommitted changes to ${listFiles(files)} would be overwritten — commit or stash them, then merge again`,
        files,
      )
    }

    const why = (e.stderr || e.message || String(err))
      .split("\n")
      .map((l) => l.replace(/^(fatal|error):\s*/, "").trim())
      .find((l) => l && !l.startsWith("Command failed"))
    return refused("failed", `could not merge ${branch}: ${why ?? "git refused"}`)
  }
}

/**
 * How a merge went. `why` is for code; `reason` is for a person.
 *
 * - `busy`: the checkout is mid-merge/rebase/cherry-pick/revert.
 * - `elsewhere`: it is not on the branch the note lands on.
 * - `empty`: the branch has nothing to merge.
 * - `conflict`: the merge was tried, conflicted, and was undone.
 * - `dirty`: the user's uncommitted files are in the way.
 * - `failed`: anything else git refused.
 */
export type Merge =
  | { merged: true }
  | {
      merged: false
      why: "busy" | "elsewhere" | "empty" | "conflict" | "dirty" | "failed"
      reason: string
      files?: string[]
    }

function refused(why: Extract<Merge, { merged: false }>["why"], reason: string, files?: string[]): Merge {
  return { merged: false, why, reason, ...(files?.length ? { files } : {}) }
}

/** A few file names, then a count — a status bar is one line. */
function listFiles(files: readonly string[]): string {
  if (!files.length) return "some files"
  const shown = files.slice(0, 3).join(", ")
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown
}

/** What the checkout is in the middle of, if anything. */
async function midOperation(repoPath: string): Promise<string | null> {
  const markers: [string, string][] = [
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ]
  for (const [name, what] of markers) {
    if (existsSync(await gitPath(repoPath, name))) return what
  }
  return null
}

/**
 * The branch a local merge of this worktree would land on, when its own base
 * branch is not known: whatever the main checkout has out right now.
 *
 * For worktrees adopted after a restart, whose base branch was never logged —
 * without it the board could only say "merge into the base branch". A
 * worktree that knows its base branch lands there or nowhere; see mergeBranch.
 */
export async function landingBranch(worktreePath: string): Promise<string | null> {
  try {
    const list = await git(worktreePath, "worktree", "list", "--porcelain")
    const main = /^worktree (.+)$/m.exec(list)?.[1]
    if (!main) return null
    const branch = await git(main, "rev-parse", "--abbrev-ref", "HEAD")
    return branch && branch !== "HEAD" ? branch : null
  } catch {
    return null
  }
}

export async function deleteBranch(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, "branch", "-D", branch).catch(() => {})
}

/**
 * Copy gitignored paths into a fresh worktree, by reference where possible.
 *
 * `cp -c` asks APFS for a clonefile(2) — the data blocks are shared until
 * something writes, so this costs metadata rather than bytes. Linux gets the
 * same via `--reflink=auto` on btrfs/XFS, which silently degrades to a real
 * copy elsewhere. Both fall back to a plain copy, because a slow worktree
 * beats a broken one.
 *
 * Note this is for `.env` files and build caches — NOT node_modules. pnpm's
 * store already clones packages by reference, so a fresh `pnpm install` is
 * sub-second; copying the tree ourselves would be slower and would hand two
 * agents the same resolved dependency graph even when their lockfiles differ.
 */
export async function carryInto(
  repoPath: string,
  worktree: string,
  paths: readonly string[],
): Promise<string[]> {
  const carried: string[] = []
  const reflink = process.platform === "darwin" ? ["-c"] : ["--reflink=auto"]

  for (const rel of paths) {
    // Never let a board config escape the repo it belongs to.
    const from = path.resolve(repoPath, rel)
    if (!from.startsWith(path.resolve(repoPath) + path.sep)) continue
    if (!existsSync(from)) continue

    const to = path.join(worktree, rel)
    try {
      mkdirSync(path.dirname(to), { recursive: true })
      await exec("cp", [...reflink, "-R", from, to])
      carried.push(rel)
    } catch {
      try {
        await exec("cp", ["-R", from, to])
        carried.push(rel)
      } catch {
        // A missing cache is a slower run, not a failed one.
      }
    }
  }
  return carried
}

/**
 * Run a board's setup command in a fresh worktree.
 *
 * Streamed line by line so the user watches it happen rather than staring at a
 * card that says "running" for ninety seconds with nothing behind it.
 */
export function runSetup(
  cwd: string,
  command: string,
  onLine: (line: string) => void,
): Promise<{ ok: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const read = (stream: NodeJS.ReadableStream | null) => {
      let buf = ""
      stream?.on("data", (c: Buffer) => {
        buf += c.toString()
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const l of lines) if (l.trim()) onLine(l.trim())
      })
    }
    read(child.stdout)
    read(child.stderr)
    child.on("error", (err) => {
      onLine(err.message)
      resolve({ ok: false, code: null })
    })
    child.on("exit", (code) => resolve({ ok: code === 0, code }))
  })
}

/** Gitignored paths worth carrying, if the repo actually has them. */
function guessCarry(root: string): string[] {
  const candidates = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".turbo",
    ".nx",
  ]
  return candidates.filter((c) => existsSync(path.join(root, c)))
}

/** What "ready to work" probably means for this repo, guessed from lockfiles. */
function guessSetup(root: string): string | null {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm install --prefer-offline"
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn install --prefer-offline"
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock")))
    return "bun install"
  if (existsSync(path.join(root, "package-lock.json"))) return "npm ci --prefer-offline"
  // No lockfile: install, but don't write one. A plain `npm install` creates
  // package-lock.json in the worktree, and it arrives in review as the first
  // file of the agent's diff — a change nobody asked for.
  if (existsSync(path.join(root, "package.json"))) return "npm install --no-package-lock"
  if (existsSync(path.join(root, "uv.lock"))) return "uv sync"
  if (existsSync(path.join(root, "poetry.lock"))) return "poetry install"
  if (existsSync(path.join(root, "Cargo.toml"))) return "cargo fetch"
  if (existsSync(path.join(root, "go.mod"))) return "go mod download"
  return null
}

/**
 * One spelling for a repository's address.
 *
 * `git@github.com:acme/app.git`, `https://github.com/acme/app` and
 * `ssh://git@github.com/acme/app.git` are one repository, cloned three ways
 * by three people. Matching a teammate's clone to a board has to see through
 * that, or a handoff fails for someone who simply prefers ssh.
 */
export function normalizeRemote(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  // A remote on disk — a shared drive, or a bare repository beside the clones
  // in a test. Resolved through symlinks, because two people naming the same
  // directory through different links are naming one repository.
  // On Windows that's C:\… or C:/…, which would otherwise read as an ssh
  // host called "C". Backslashes become slashes, so one repository has one
  // spelling however it was typed.
  if (u.startsWith("/") || u.startsWith("file://") || /^[A-Za-z]:[\\/]/.test(u)) {
    const p = u.replace(/^file:\/\/\/?(?=[A-Za-z]:)/, "").replace(/^file:\/\//, "")
    let real = p
    try {
      real = realpathSync(p)
    } catch {
      // Not on this disk; keep what was written.
    }
    return `file:${real.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\.git$/, "")}`
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(u)
  let host: string, rest: string
  if (scp && !u.includes("://")) {
    host = scp[1]!
    rest = scp[2]!
  } else {
    try {
      const parsed = new URL(u)
      host = parsed.hostname
      rest = parsed.pathname
    } catch {
      return null
    }
  }
  rest = rest.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "")
  return rest ? `${host.toLowerCase()}/${rest}` : null
}

/** This repository's origin, normalised; the first remote if it has no `origin`. */
export async function originOf(repoPath: string): Promise<string | null> {
  const remotes = (await git(repoPath, "remote").catch(() => "")).split("\n").map((r) => r.trim()).filter(Boolean)
  const name = remotes.includes("origin") ? "origin" : remotes[0]
  if (!name) return null
  return normalizeRemote(await git(repoPath, "remote", "get-url", name).catch(() => ""))
}

/**
 * The remote kandy pushes to: `origin`, or the first remote if there is no
 * `origin`. One answer for every push — a handoff, a pull request, a merged
 * PR's branch — so a branch never lands on two remotes by two rules.
 */
export async function remoteName(repoPath: string): Promise<string | null> {
  const remotes = (await git(repoPath, "remote").catch(() => "")).split("\n").map((r) => r.trim()).filter(Boolean)
  return remotes.includes("origin") ? "origin" : (remotes[0] ?? null)
}

/**
 * Send a note's branch to the remote, so another machine can pick it up.
 *
 * From the machine that has it, with its owner's own credentials — the hub
 * never holds a forge token. A repository with no remote cannot hand work to
 * anyone, and says so, rather than pretending the other side will find it.
 */
export async function pushBranch(repoPath: string, branch: string): Promise<{ remote: string }> {
  const remote = await remoteName(repoPath)
  if (!remote) throw new Error("this repository has no remote, so there is nowhere to send the branch for someone else to pick up")
  try {
    await git(repoPath, "push", "--quiet", "-u", remote, branch)
  } catch (err) {
    throw new Error(`could not push ${branch} to ${remote}: ${err instanceof Error ? err.message.split("\n")[0] : err}`)
  }
  return { remote }
}

/**
 * A checkout of a branch someone else started, for this machine to continue.
 *
 * The branch is fetched from the remote and checked out as a local branch of
 * the same name, so a commit here goes on top of theirs and a push later
 * goes back to the same place. If this machine already has the branch — the
 * same person on the same machine, picking a note back up — it is used, and
 * fast-forwarded to whatever the remote has since. Null when the branch is
 * nowhere to be found; the caller starts fresh rather than failing the run.
 *
 * The base is the commit the work started from, which the previous run
 * recorded, so the diff this machine shows is the whole of the note's work
 * and not merely what was added here.
 */
export async function continueBranch(
  repoPath: string,
  noteId: string,
  branch: string,
  baseRef: string | null,
): Promise<Worktree | null> {
  const remote = await remoteName(repoPath)
  if (remote) await git(repoPath, "fetch", "--quiet", remote, branch).catch(() => {})

  const local = await git(repoPath, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).catch(() => "")
  const tracked = remote
    ? await git(repoPath, "rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`).catch(() => "")
    : ""
  if (!local && !tracked) return null

  await ensureExcluded(repoPath)
  const root = worktreeRoot(repoPath)
  mkdirSync(root, { recursive: true })
  const dir = path.join(root, noteId)

  if (local) {
    await git(repoPath, "worktree", "add", dir, branch)
    if (tracked) await git(dir, "merge", "--ff-only", "--quiet", `${remote}/${branch}`).catch(() => {})
  } else {
    await git(repoPath, "worktree", "add", "--track", "-b", branch, dir, `${remote}/${branch}`)
  }

  const baseBranch = await git(repoPath, "rev-parse", "--abbrev-ref", "HEAD")
    .then((b) => (b && b !== "HEAD" ? b : null))
    .catch(() => null)
  const known = baseRef ? await git(repoPath, "cat-file", "-e", `${baseRef}^{commit}`).then(() => true).catch(() => false) : false
  const base = known ? baseRef! : await git(dir, "merge-base", "HEAD", baseBranch ?? "HEAD").catch(() => "HEAD")
  return { path: dir, branch, baseRef: base, baseBranch }
}

/** Inspect a path before offering to make a board of it. */
export async function checkRepo(p: string): Promise<{
  path: string
  exists: boolean
  isRepo: boolean
  dirty: boolean
  head: string | null
  branch: string | null
  name: string | null
  suggestedSetup: string | null
  suggestedCarry: string[]
  remote: string | null
  error: string | null
}> {
  const base = {
    path: p,
    exists: false,
    isRepo: false,
    dirty: false,
    head: null,
    branch: null,
    name: null,
    suggestedSetup: null,
    suggestedCarry: [],
    remote: null,
    error: null,
  }
  // path.isAbsolute, not a leading "/": on Windows an absolute path is C:\…
  if (!path.isAbsolute(p)) return { ...base, error: "path must be absolute" }
  if (!existsSync(p)) return { ...base, error: "no such directory" }

  try {
    // --show-toplevel rather than a .git check: a path *inside* a repo should
    // resolve to the repo, not be rejected.
    const root = await git(p, "rev-parse", "--show-toplevel")
    const [head, branch, status] = await Promise.all([
      git(root, "rev-parse", "--short", "HEAD").catch(() => ""),
      git(root, "rev-parse", "--abbrev-ref", "HEAD").catch(() => ""),
      git(root, "status", "--porcelain"),
    ])
    return {
      path: root,
      exists: true,
      isRepo: true,
      dirty: status !== "",
      head: head || null,
      branch: branch || null,
      name: path.basename(root),
      suggestedSetup: guessSetup(root),
      suggestedCarry: guessCarry(root),
      remote: await originOf(root),
      // Still a repository, and a fine board once it has a commit — but every
      // run would fail until then, so say so now rather than at the first one.
      error: head ? null : NO_COMMITS,
    }
  } catch {
    return { ...base, exists: true, error: "not a git repository" }
  }
}

/** True if the user has uncommitted work. Notes branch from HEAD and won't see
 *  it — a board whose agents silently can't see your last hour is a betrayal,
 *  so callers surface this rather than swallowing it. */
export async function isDirty(repoPath: string): Promise<boolean> {
  return (await git(repoPath, "status", "--porcelain")) !== ""
}

/**
 * What `@` can point at: every tracked file, and every folder holding one.
 *
 * `ls-files` rather than a directory walk, because it already knows what is
 * tracked and what is ignored — node_modules and build output never appear and
 * nobody maintains a list of things to skip.
 *
 * Folders are derived from the same output rather than read separately. git
 * does not track directories, so the only honest definition of "a folder in
 * this repo" is one that contains a tracked file, and deriving it here means
 * the two lists cannot disagree about what exists.
 *
 * Capped, because a monorepo can track tens of thousands of paths and this
 * crosses the wire to fill a menu that shows eight of them.
 */
export async function trackedPaths(
  repoPath: string,
  cap = 20000,
): Promise<{ files: string[]; dirs: string[] }> {
  const out = await git(repoPath, "ls-files", "-z")
  const files = out.split("\0").filter(Boolean).slice(0, cap)

  const dirs = new Set<string>()
  for (const f of files) {
    let i = f.indexOf("/")
    while (i !== -1) {
      dirs.add(f.slice(0, i))
      i = f.indexOf("/", i + 1)
    }
  }
  return { files, dirs: [...dirs].sort() }
}

export type Retired =
  | { removed: true; pushed: boolean; branchKept: boolean }
  | { removed: false; reason: string }

/**
 * Put a finished note's checkout away without losing a line of its work.
 *
 * The rule is the one that makes deleting safe: **the local branch goes only
 * once its work is somewhere else.** The checkout is only a place the work
 * happened; the branch is the work.
 *
 * This replaces two paths that disagreed and one that lost work. Discarding a
 * note force-removed its worktree and deleted its branch — so the agent's
 * commits *and* anything uncommitted were gone. A merged PR force-removed the
 * worktree too, and never told the log, so the note went on naming a
 * directory that no longer existed.
 *
 * In order, and each step can stop the next:
 *
 * 1. Uncommitted changes → keep everything. Nothing here commits on anyone's
 *    behalf, and `--force` is never used.
 * 2. With `push` (a pull request that merged: the branch is already the
 *    remote's business) and a remote → push the branch. If the push fails,
 *    keep everything: the checkout might be the only copy.
 * 3. Remove the worktree.
 * 4. Delete the local branch only if it has nothing on it, reached the
 *    remote, or is already part of `into` — a local merge. Otherwise it is
 *    the only copy of the work, and it stays.
 *
 * A review never pushes. A merge made here is on the user's branch, and what
 * they push is up to them; a discard is work somebody decided against, and
 * a shared remote is the last place it belongs. It stays on this machine as a
 * local branch, where it can be recovered and nobody else has to see it.
 *
 * A branch with nothing on it beyond its base has nothing to lose, and is not
 * pushed — a remote full of empty branches is its own kind of mess.
 */
export async function retireWorktree(
  repoPath: string,
  wt: { path: string; branch: string; baseRef: string },
  opts: { push?: boolean; into?: string | null } = { push: true },
): Promise<Retired> {
  if (existsSync(wt.path) && (await isDirty(wt.path))) {
    return { removed: false, reason: "uncommitted changes in the checkout" }
  }

  const ahead = Number(
    (await git(repoPath, "rev-list", "--count", `${wt.baseRef}..${wt.branch}`).catch(() => "0")).trim(),
  )
  const remote = opts.push ? await remoteName(repoPath) : null

  let pushed = false
  if (ahead > 0 && remote) {
    try {
      await git(repoPath, "push", "--quiet", "-u", remote, wt.branch)
      pushed = true
    } catch (err) {
      const why = err instanceof Error ? err.message.split("\n")[0]! : String(err)
      return { removed: false, reason: `could not push ${wt.branch} to ${remote}: ${why}` }
    }
  }

  if (existsSync(wt.path)) await removeWorktree(repoPath, wt.path)

  // Nothing on it, safely on the remote, or merged: the local branch is
  // clutter. Anything else: the local branch is the work.
  const merged =
    !!opts.into &&
    (await git(repoPath, "merge-base", "--is-ancestor", wt.branch, opts.into).then(() => true).catch(() => false))
  const branchKept = ahead > 0 && !pushed && !merged
  if (!branchKept) await deleteBranch(repoPath, wt.branch)

  return { removed: true, pushed, branchKept }
}
