import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Forge, PullRequest } from "@kandy/core"
import { remoteName } from "./worktree.js"

const exec = promisify(execFile)

/**
 * Pull requests, via the `gh` CLI.
 *
 * Same principle as the agents: we shell out to the tool the user already
 * installed and authenticated rather than handling a GitHub token ourselves.
 * If `gh` isn't there, the PR affordances simply don't appear — a board
 * against a local-only repo shouldn't grow buttons that can't work.
 */
async function gh(cwd: string, args: string[], timeout = 20_000): Promise<string> {
  const { stdout } = await exec("gh", args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

export async function detectForge(repoPath: string): Promise<Forge> {
  const none = (reason: string): Forge => ({
    available: false,
    repo: null,
    defaultBranch: null,
    reason,
  })
  try {
    await exec("gh", ["--version"], { timeout: 5000 })
  } catch {
    return none("gh CLI not installed")
  }
  try {
    const raw = await gh(repoPath, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"])
    const j = JSON.parse(raw) as {
      nameWithOwner?: string
      defaultBranchRef?: { name?: string }
    }
    return {
      available: true,
      repo: j.nameWithOwner ?? null,
      defaultBranch: j.defaultBranchRef?.name ?? null,
      reason: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Distinguish "not a GitHub repo" from "you aren't logged in", because the
    // fix is completely different and the user can only act on the difference.
    if (/auth|login|token/i.test(msg)) return none("gh is not authenticated — run `gh auth login`")
    return none("no GitHub remote for this repo")
  }
}

const FIELDS = "number,url,title,state,isDraft,statusCheckRollup,reviewDecision,updatedAt"

/** The PR for a branch, if one exists. Null is a normal answer, not an error. */
export async function prForBranch(
  repoPath: string,
  branch: string,
): Promise<PullRequest | null> {
  try {
    const raw = await gh(repoPath, [
      "pr",
      "list",
      "--head",
      branch,
      // A merged PR still matters — it's how a note proves it landed.
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      FIELDS,
    ])
    const list = JSON.parse(raw) as unknown[]
    return list.length ? normalize(list[0]) : null
  } catch {
    return null
  }
}

/** Push the branch and open a PR for it. */
export async function openPr(
  repoPath: string,
  branch: string,
  title: string,
  body: string,
  draft: boolean,
): Promise<PullRequest> {
  // The remote every other push of kandy's goes to, so a handed-over branch
  // and its pull request are never on two different remotes. -u so the
  // branch tracks it; re-pushing an existing branch is a no-op.
  const remote = await remoteName(repoPath)
  if (!remote) throw new Error("this repository has no remote to push the branch to")
  await exec("git", ["push", "-u", remote, branch], { cwd: repoPath, timeout: 120_000 })

  const args = ["pr", "create", "--head", branch, "--title", title, "--body", body]
  if (draft) args.push("--draft")
  await gh(repoPath, args, 60_000)

  const pr = await prForBranch(repoPath, branch)
  if (!pr) throw new Error("PR was created but could not be read back")
  return pr
}

function normalize(raw: unknown): PullRequest {
  const p = raw as Record<string, any>
  const rollup: { state?: string; conclusion?: string }[] = Array.isArray(p["statusCheckRollup"])
    ? p["statusCheckRollup"]
    : []

  let checks: PullRequest["checks"] = null
  if (rollup.length) {
    // A check is either finished with a verdict, or it isn't finished.
    const verdicts = rollup.map((c) => (c.conclusion ?? c.state ?? "").toUpperCase())
    if (verdicts.some((v) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].includes(v)))
      checks = "failing"
    else if (verdicts.some((v) => ["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED"].includes(v)))
      checks = "pending"
    else checks = "passing"
  }

  const decision = String(p["reviewDecision"] ?? "").toLowerCase()

  return {
    number: Number(p["number"] ?? 0),
    url: String(p["url"] ?? ""),
    title: String(p["title"] ?? ""),
    state: (String(p["state"] ?? "OPEN").toLowerCase() as PullRequest["state"]) ?? "open",
    draft: Boolean(p["isDraft"]),
    checks,
    review:
      decision === "approved" || decision === "changes_requested" || decision === "review_required"
        ? (decision as PullRequest["review"])
        : null,
    updatedAt: Date.parse(String(p["updatedAt"] ?? "")) || Date.now(),
  }
}
