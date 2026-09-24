import { homedir } from "node:os"
import path from "node:path"
import type {
  AgentId,
  AgentInfo,
  Delivery,
  Forge,
  Listing,
  PullRequest,
  Rejection,
  RepoCheck,
  SkillInfo,
  StagedFile,
  UploadFile,
} from "@kandy/core"
import type { Runner } from "./runner.js"
import type { LiveDiff, Reviewed, Verdict, Workshop } from "./workshop.js"
import { detectForge, openPr } from "./forge.js"
import { limitsFor } from "./limits.js"
import {
  clearStaged,
  describe,
  saveAttachments,
  screen,
  stageAttachments,
  stagedFor,
  unstageAttachment,
} from "./attach.js"
import { defaultModelFor, modelsFor, warmPrices } from "./pricing.js"
import { list as listDir, nativePick, repos, suggestions } from "./browse.js"
import { warmCatalogue } from "./agents/catalogue.js"
import { setCustomModels } from "./agents/custom-models.js"
import { detectAll } from "./agents/index.js"
import { addSkills, commitSkills, listSkills, removeSkill } from "./capabilities/skills.js"
import {
  checkRepo,
  deleteBranch,
  diff as gitDiff,
  diffStat,
  mergeBranch,
  removeWorktree,
  retireWorktree,
  trackedPaths,
  commitLeftovers,
  pushBranch,
} from "./worktree.js"

/**
 * The workshop a hub sharing a process with its runner talks to.
 *
 * Every method is the code a route used to run inline, moved rather than
 * rewritten, so `kandy serve` answers exactly as it did. Like `LocalLog`, it
 * exists so the single-player daemon goes through the same interface a remote
 * runner will, rather than keeping a shortcut that would let the two drift.
 *
 * Several of these were synchronous and are now promises that resolve at
 * once. That costs a microtask; the alternative is an interface with two
 * shapes, one of which only works in-process.
 */
export class LocalWorkshop implements Workshop {
  constructor(private readonly runner: Runner) {}

  // -------------------------------------------------------------------------
  // Run control
  // -------------------------------------------------------------------------

  async request(boardId: string, noteId: string, agent: AgentId): Promise<string> {
    return this.runner.request(boardId, noteId, agent)
  }

  async steer(boardId: string, noteId: string, text: string): Promise<Delivery> {
    return this.runner.steer(boardId, noteId, text)
  }

  async escalate(boardId: string, noteId: string): Promise<Delivery> {
    return this.runner.escalate(boardId, noteId)
  }

  async cancel(runId: string): Promise<boolean> {
    return this.runner.cancel(runId)
  }

  async syncColumn(boardId: string, noteId: string): Promise<void> {
    this.runner.syncColumn(boardId, noteId)
  }

  // -------------------------------------------------------------------------
  // A note's workspace
  // -------------------------------------------------------------------------

  async stage(noteId: string, files: UploadFile[]): Promise<{ staged: StagedFile[]; rejected: Rejection[] }> {
    return stageAttachments(noteId, files)
  }

  async staged(noteId: string): Promise<StagedFile[]> {
    return stagedFor(noteId)
  }

  async unattach(noteId: string, name: string): Promise<StagedFile[]> {
    unstageAttachment(noteId, name)
    return stagedFor(noteId)
  }

  async attach(
    noteId: string,
    files: UploadFile[],
  ): Promise<{ attachments: StagedFile[]; rejected: Rejection[] }> {
    const wt = this.runner.worktreeOf(noteId)
    // Once there is a workspace the files belong in it — that is the path the
    // agent opens. Before there is one they wait in the state dir.
    if (wt) {
      const { accepted, rejected } = screen(files)
      const saved = saveAttachments(wt.path, accepted)
      return { attachments: saved.map((f) => ({ name: f.name, bytes: f.bytes })), rejected }
    }
    const { staged, rejected } = stageAttachments(noteId, files)
    return { attachments: staged, rejected }
  }

  async messageFiles(noteId: string, files: UploadFile[]): Promise<{ mention: string; rejected: Rejection[] }> {
    // Attachments go into the note's worktree, so the path we hand the agent
    // is one it can actually open. A note with no worktree is about to get
    // one — steering it queues a run — so its files are staged and the run
    // moves them in and names them in the prompt itself.
    const wt = this.runner.worktreeOf(noteId)
    if (wt) {
      const screened = screen(files)
      return { mention: describe(saveAttachments(wt.path, screened.accepted)), rejected: screened.rejected }
    }
    return { mention: "", rejected: stageAttachments(noteId, files).rejected }
  }

  async handoff(repoPath: string, noteId: string): Promise<{ branch: string }> {
    if (this.runner.isRunning(noteId)) {
      throw Object.assign(new Error("it is still running here — wait for it to finish, or stop it"), { status: 409 })
    }
    const wt = this.runner.worktreeOf(noteId)
    if (!wt) throw Object.assign(new Error("there is no checkout of this note on this machine to hand over"), { status: 409 })
    // Anything uncommitted would stay behind on this laptop. It goes with the
    // branch, so the next person has all of it.
    await commitLeftovers(wt, "Work in progress, handed over")
    await pushBranch(repoPath, wt.branch)
    return { branch: wt.branch }
  }

  async diff(noteId: string): Promise<LiveDiff | null> {
    // The live worktree is the truth while it exists — a note can still be
    // running, and its diff grows under us.
    const wt = this.runner.worktreeOf(noteId)
    if (!wt) return null
    try {
      const [diff, stat] = await Promise.all([gitDiff(wt), diffStat(wt)])
      return { diff, stat, branch: wt.branch, baseBranch: wt.baseBranch }
    } catch {
      // Worktree remembered but no longer on disk. The snapshot is all we have.
      return null
    }
  }

  async review(repoPath: string, noteId: string, verdict: Verdict): Promise<Reviewed> {
    const wt = this.runner.worktreeOf(noteId)
    let outcome: Reviewed = { checkout: "none" }
    if (wt) {
      if (verdict.decision === "merge") {
        const result = await mergeBranch(repoPath, wt.branch, verdict.land)
        if (!result.merged) {
          // Leave everything exactly as it was. A conflict is the user's
          // call, and they still have the branch and the worktree.
          return { checkout: "conflict", branch: wt.branch, conflict: result.conflict ?? "" }
        }
      }
      /*
       * Both verdicts end the same way, and that way used to lose work: the
       * worktree was force-removed and the branch deleted, so discarding a
       * note destroyed the agent's commits and anything uncommitted, with
       * nothing pushed first. Push, then delete — and if either cannot be
       * done safely, keep the checkout and say why.
       */
      const retired = await retireWorktree(repoPath, wt).catch(
        (err: unknown) => ({ removed: false as const, reason: String(err) }),
      )
      if (retired.removed) {
        this.runner.forget(noteId)
        outcome = { checkout: "removed" }
      } else {
        outcome = { checkout: "kept", reason: retired.reason }
      }
    }
    // Merged or discarded, the note is finished with; anything still staged
    // for it would outlive the thing it was attached to.
    clearStaged(noteId)
    return outcome
  }

  async deleteNote(repoPath: string, noteId: string, worktree: string | null): Promise<void> {
    clearStaged(noteId)

    /*
     * Take the worktree with it.
     *
     * Deleting a note used to leave its checkout on disk — a whole copy of
     * the repo, 376MB in the case that found this — and nothing could ever
     * reclaim it: gc matches a directory to a note by name and skips any it
     * cannot identify, which a deleted note is by definition. The space was
     * unreachable from every direction.
     *
     * The branch is kept. A worktree is a working copy and reproducible; a
     * branch is the work. Deleting a note should not be able to destroy the
     * only record of what an agent did.
     */
    const wt = this.runner.worktreeOf(noteId)
    if (wt) {
      await removeWorktree(repoPath, wt.path, true).catch(() => {})
      this.runner.forget(noteId)
    } else if (worktree) {
      // Known only from the note itself — the runner forgets a worktree once
      // its run ends, so a finished note's checkout is nobody's but ours.
      await removeWorktree(repoPath, worktree, true).catch(() => {})
    }
  }

  forge(repoPath: string): Promise<Forge> {
    return detectForge(repoPath)
  }

  openPr(repoPath: string, branch: string, title: string, body: string, draft: boolean): Promise<PullRequest> {
    return openPr(repoPath, branch, title, body, draft)
  }

  // -------------------------------------------------------------------------
  // A board's repository
  // -------------------------------------------------------------------------

  checkRepo(p: string): Promise<RepoCheck> {
    return checkRepo(expandHome(p))
  }

  async removeBoard(repoPath: string, noteIds: string[]): Promise<void> {
    // Worktrees live inside the user's repo; leaving them behind would be
    // litter in a directory kandy no longer tracks.
    for (const noteId of noteIds) {
      const wt = this.runner.worktreeOf(noteId)
      if (wt) {
        await removeWorktree(repoPath, wt.path, true).catch(() => {})
        await deleteBranch(repoPath, wt.branch)
        this.runner.forget(noteId)
      }
    }
  }

  async files(repoPath: string): Promise<{ files: string[]; dirs: string[]; error?: string }> {
    try {
      return await trackedPaths(repoPath)
    } catch (err) {
      // A repo that cannot be read is not an error worth a banner; the picker
      // simply has nothing to offer.
      return { files: [], dirs: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  /*
   * Skills. Read from the repository on every request rather than kept in the
   * log: git is their home and their transport, and a copy in the log would
   * be a second truth that goes stale the first time someone runs the
   * `skills` CLI by hand.
   */

  skills(repoPath: string): Promise<SkillInfo[]> {
    return cliWords(() => listSkills(repoPath))
  }

  addSkills(repoPath: string, source: string, skill?: string): Promise<SkillInfo[]> {
    return cliWords(async () => {
      await addSkills(repoPath, source, skill)
      return listSkills(repoPath)
    })
  }

  removeSkill(repoPath: string, name: string): Promise<SkillInfo[]> {
    return cliWords(async () => {
      await removeSkill(repoPath, name)
      return listSkills(repoPath)
    })
  }

  commitSkills(repoPath: string): Promise<{ committed: string[]; skills: SkillInfo[] }> {
    return cliWords(async () => {
      const committed = await commitSkills(repoPath)
      return { committed, skills: await listSkills(repoPath) }
    })
  }

  async browse(p: string | null): Promise<Listing> {
    return {
      ...listDir(p ?? homedir()),
      suggestions: suggestions(),
      // The list the picker actually wants: repos, not every folder.
      repos: repos(),
    }
  }

  async pick(): Promise<{ path: string | null; supported: boolean }> {
    const picked = await nativePick()
    return { path: picked, supported: process.platform === "darwin" }
  }

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  async agents(): Promise<AgentInfo[]> {
    /*
     * What the files say, corrected by what actually happened.
     *
     * A run that was refused outranks a credential that looks fine, because
     * the CLI's own init succeeds on cached credentials and only a real
     * attempt proves anything.
     */
    const failures = new Map(this.runner.agentsFailingAuth().map((f) => [f.agent, f.at]))
    return (await detectAll()).map((a) => {
      const at = failures.get(a.id) ?? null
      const limits = limitsFor(a.id)
      return at
        ? { ...a, authed: false, authFailedAt: at, limits }
        : { ...a, authFailedAt: null, limits }
    })
  }

  async models(agent: string): Promise<string[]> {
    // Both are cached with their own TTLs, so this is a no-op most of the time.
    await Promise.all([warmPrices(), warmCatalogue(agent)])
    const version = (await detectAll()).find((a) => a.id === agent)?.version ?? null
    return modelsFor(agent, version)
  }

  async setModels(agent: string, ids: string[]): Promise<string[]> {
    return setCustomModels(agent, ids)
  }

  async defaultModels(): Promise<Record<string, string>> {
    // Pick a default model per installed agent rather than leaving every new
    // board on "whatever the agent feels like". A stated default is something
    // you can disagree with; an unstated one is something you discover.
    await warmPrices()
    const models: Record<string, string> = {}
    for (const a of await detectAll()) {
      if (!a.installed) continue
      const pick = defaultModelFor(a.id)
      if (pick) models[a.id] = pick
    }
    return models
  }
}

/**
 * Rethrow a `skills` CLI failure as the CLI's own words, trimmed.
 *
 * "no skills found in that repo" is more use than a generic failure, and it is
 * never a secret. Done here rather than in the route because `stderr` is a
 * property of a child process, and only the message survives the trip to a
 * hub.
 */
async function cliWords<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const why = (e.stderr?.trim() || e.message || String(err)).split("\n").slice(-3).join(" ").slice(0, 400)
    throw new Error(why)
  }
}

/** `~/code/thing` is what people actually type. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p
}
