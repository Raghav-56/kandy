import { execFile } from "node:child_process"
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { SkillInfo } from "@kandy/core"
import { git } from "../worktree.js"

const run = promisify(execFile)

/**
 * A board's skills, which live in its repository.
 *
 * kandy does not install skills itself. The `skills` CLI already does, it
 * already writes the lockfile, and it already links each skill into every
 * agent that needs a link — `skills list --json` on this repository reports
 * each one reaching Claude Code, Codex, Cursor and OpenCode from a single
 * `.agents/skills/<name>` plus a `.claude/skills/<name>` symlink. A second
 * installer would be a second lockfile format to drift from.
 *
 * What it does add is the one thing that tool cannot see, because it has no
 * idea kandy runs agents somewhere other than your checkout:
 *
 * **An uncommitted skill reaches no agent kandy runs.** A note's worktree is
 * checked out from git, so a skill that is only on your disk is absent from
 * it. Measured on this repository when this was written: fourteen skills
 * installed, two committed, two visible inside a worktree. Twelve skills the
 * user had deliberately installed were invisible to every run.
 *
 * Carrying them into each worktree would fix it here and fail silently
 * everywhere else — a teammate's runner checks out from git too. So the fix is
 * to say so and offer to commit them, after which git carries them to every
 * worktree, every runner and every handoff, with no help from us.
 */

/** Where skills are found, relative to the repository. `.agents` first: it is the shared home. */
const ROOTS = [path.join(".agents", "skills"), path.join(".claude", "skills")]

export async function listSkills(repo: string): Promise<SkillInfo[]> {
  const lock = readLock(repo)
  const seen = new Map<string, SkillInfo>()

  for (const root of ROOTS) {
    const dir = path.join(repo, root)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).sort()) {
      if (seen.has(name)) continue
      const rel = path.join(root, name)
      const skillMd = path.join(repo, rel, "SKILL.md")
      if (!existsSync(skillMd)) continue
      // A link into `.agents/skills` is the same skill seen from Claude's side,
      // already listed from the first root. One skill, listed once.
      if (isLinkInto(path.join(repo, rel), path.join(repo, ROOTS[0]!))) continue

      const front = frontmatter(readFileSync(skillMd, "utf8"))
      seen.set(name, {
        name: front.name ?? name,
        description: front.description,
        path: rel,
        source: lock[name] ?? null,
        committed: await tracked(repo, path.join(rel, "SKILL.md")),
      })
    }
  }
  return [...seen.values()]
}

/**
 * `npx skills add <source>`, non-interactively, for every agent.
 *
 * `source` is whatever the `skills` CLI accepts — `owner/repo`, a GitHub URL.
 * It is passed as an argument and never through a shell, and anything that
 * starts with `-` is refused, so it cannot be read as an option either.
 */
export async function addSkills(repo: string, source: string, skill?: string): Promise<void> {
  if (!source.trim() || source.startsWith("-")) throw new Error("not a skill source")
  if (skill !== undefined && !/^[A-Za-z0-9._*-]+$/.test(skill)) throw new Error("not a skill name")
  await run(
    "npx",
    ["-y", "skills", "add", source, "-y", "-a", "*", ...(skill ? ["--skill", skill] : [])],
    { cwd: repo, timeout: 180_000, env: { ...process.env, CI: "1" } },
  )
}

export async function removeSkill(repo: string, name: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("not a skill name")
  await run("npx", ["-y", "skills", "remove", name, "-y"], {
    cwd: repo,
    timeout: 120_000,
    env: { ...process.env, CI: "1" },
  })
}

/**
 * Commit every skill git does not know about yet, and nothing else.
 *
 * On whatever branch the repository has checked out, because that is where
 * the user is and it is an explicit action. `git commit -- <paths>` commits
 * only those paths, so anything else the user has staged stays staged and
 * out of this commit. Hooks run: this is their repository, not a worktree
 * kandy owns.
 */
export async function commitSkills(repo: string): Promise<string[]> {
  const loose = (await listSkills(repo)).filter((s) => !s.committed)
  if (loose.length === 0) return []

  const paths = new Set<string>()
  for (const s of loose) {
    paths.add(s.path)
    // Every agent directory's link to it, so Claude sees it too.
    for (const link of linksTo(repo, path.join(repo, s.path))) paths.add(link)
  }
  if (existsSync(path.join(repo, "skills-lock.json"))) paths.add("skills-lock.json")

  const list = [...paths]
  await git(repo, "add", "--", ...list)
  const names = loose.map((s) => s.name)
  await git(repo, "commit", "-m", `Add agent skills: ${names.join(", ")}`, "--", ...list)
  return names
}

// ── helpers ───────────────────────────────────────────────────────────────

async function tracked(repo: string, rel: string): Promise<boolean> {
  try {
    return (await git(repo, "ls-files", "--", rel)).trim() !== ""
  } catch {
    return false
  }
}

function readLock(repo: string): Record<string, string> {
  try {
    const lock = JSON.parse(readFileSync(path.join(repo, "skills-lock.json"), "utf8")) as {
      skills?: Record<string, { source?: string }>
    }
    return Object.fromEntries(
      Object.entries(lock.skills ?? {}).flatMap(([k, v]) => (v.source ? [[k, v.source]] : [])),
    )
  } catch {
    return {}
  }
}

function isLinkInto(p: string, dir: string): boolean {
  try {
    if (!lstatSync(p).isSymbolicLink()) return false
    const target = realpathSync(p)
    const home = realpathSync(dir)
    return target.startsWith(home + path.sep)
  } catch {
    return false
  }
}

/**
 * Symlinks in any top-level agent directory — `.claude/skills/<n>`,
 * `.cursor/skills/<n>` — that resolve to this skill. Found rather than listed,
 * because the set of agents the `skills` CLI links for grows on its own.
 */
function linksTo(repo: string, skillDir: string): string[] {
  const out: string[] = []
  let target: string
  try {
    target = realpathSync(skillDir)
  } catch {
    return out
  }
  for (const top of readdirSync(repo)) {
    if (!top.startsWith(".") || top === ".git") continue
    const skills = path.join(repo, top, "skills")
    if (!existsSync(skills)) continue
    for (const n of readdirSync(skills)) {
      const p = path.join(skills, n)
      try {
        if (lstatSync(p).isSymbolicLink() && realpathSync(p) === target) {
          out.push(path.relative(repo, p))
        }
      } catch {
        // A dangling link is not ours to commit.
      }
    }
  }
  return out
}

/**
 * `name` and `description` from a SKILL.md's frontmatter.
 *
 * Not a YAML parser, on purpose: these two keys are all the board shows, and
 * the forms people actually write — plain, quoted, and folded with `>` — are
 * handled. Anything stranger shows no description rather than a wrong one.
 */
export function frontmatter(md: string): { name: string | null; description: string | null } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!m) return { name: null, description: null }
  const lines = m[1]!.split(/\r?\n/)

  const read = (key: string): string | null => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i < 0) return null
    const rest = lines[i]!.slice(key.length + 1).trim()
    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      const body: string[] = []
      for (const l of lines.slice(i + 1)) {
        if (!/^\s+/.test(l)) break
        body.push(l.trim())
      }
      return body.join(" ").trim() || null
    }
    const unquoted = rest.replace(/^(["'])(.*)\1$/, "$2").trim()
    return unquoted || null
  }

  return { name: read("name"), description: read("description") }
}
