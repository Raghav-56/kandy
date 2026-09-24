import type {
  AgentId,
  AgentInfo,
  Delivery,
  DiffStat,
  Forge,
  Listing,
  PullRequest,
  Rejection,
  RepoCheck,
  SkillInfo,
  StagedFile,
  UploadFile,
} from "@kandy/core"

/**
 * Everything the HTTP API asks of the machine that holds the repositories.
 *
 * The mirror of `Log`. That interface is what a runner needs from the board;
 * this one is what the board needs from a runner. Until now `http.ts` reached
 * straight into the `Runner` and into git — `runner.steer`, `mergeBranch`,
 * `trackedPaths`, a native folder picker — which is fine while the API and the
 * checkouts share a process, and wrong the moment they do not. A hub answers
 * clients and keeps the log; it must never spawn an agent, open a worktree, or
 * hold anyone's `gh` credentials. Every one of those now goes through here.
 *
 * `kandy serve` gets `LocalWorkshop`, which is the calls the routes used to
 * make. A hub will get one that forwards over the wire to whichever runner
 * holds the repo. The routes do not change between the two, which is the
 * whole point — the alternative is a second API that drifts from the first.
 *
 * ## Why everything is a promise of plain data
 *
 * Because it will be an RPC. Arguments and results are JSON: no `Worktree`,
 * no `Buffer`, no callbacks. A method returns exactly what the route puts on
 * the wire — a diff and its stat, a `Delivery`, the staged files — rather than
 * a handle for the route to dig through, since a handle cannot cross a
 * network and digging is a second round trip.
 *
 * A method that fails rejects with an `Error` whose `message` is the reason a
 * person should read. That message is the only part of a rejection a remote
 * workshop has to carry, and the routes use nothing else.
 *
 * ## What stays out
 *
 * The log. A workshop never emits a domain event on a route's behalf: an event
 * that states what the user asked for is written by the route, where it always
 * was. Where an event records what the disk did — a checkout reclaimed after
 * a review — the workshop does the work and reports the outcome, and the route
 * writes it down. The runner's own events (a run starting, a note changing
 * lane) are a different matter; it writes those through its `Log` either way.
 */
export interface Workshop {
  // -------------------------------------------------------------------------
  // Run control — the runner itself.
  // -------------------------------------------------------------------------

  /** Queue a run. Resolves to the run's id before it has started. */
  request(boardId: string, noteId: string, agent: AgentId): Promise<string>

  /** Talk to the live agent, or queue a follow-up that resumes it. */
  steer(boardId: string, noteId: string, text: string): Promise<Delivery>

  /** Continue a refused note on full access. The route has already set the policy. */
  escalate(boardId: string, noteId: string): Promise<Delivery>

  /** Whether there was a run to stop. */
  cancel(runId: string): Promise<boolean>

  /** Move a note into the lane its status says it belongs in. */
  syncColumn(boardId: string, noteId: string): Promise<void>

  // -------------------------------------------------------------------------
  // A note's workspace — its checkout, and the files waiting for one.
  // -------------------------------------------------------------------------

  /** Hold files for a note that has no worktree yet. */
  stage(noteId: string, files: UploadFile[]): Promise<{ staged: StagedFile[]; rejected: Rejection[] }>

  /** What is staged for a note. Empty once it has run. */
  staged(noteId: string): Promise<StagedFile[]>

  /** Take one staged file back. Resolves to what is left. */
  unattach(noteId: string, name: string): Promise<StagedFile[]>

  /** Into the worktree if there is one, onto the stage if not. */
  attach(noteId: string, files: UploadFile[]): Promise<{ attachments: StagedFile[]; rejected: Rejection[] }>

  /**
   * Files that arrived with a steering message.
   *
   * `mention` is what to append to the message so the agent knows where they
   * are — empty when they were staged, since the run that adopts them names
   * them in its own prompt.
   */
  messageFiles(noteId: string, files: UploadFile[]): Promise<{ mention: string; rejected: Rejection[] }>

  /** The live diff, or null when there is no checkout to read one from. */
  diff(noteId: string): Promise<LiveDiff | null>

  /**
   * Land or drop a note's checkout, as a review decided.
   *
   * `revise` is not here: it is steering, and `steer` is already that.
   */
  review(repoPath: string, noteId: string, verdict: Verdict): Promise<Reviewed>

  /**
   * Remove a deleted note's checkout, and anything staged for it.
   *
   * `worktree` is the directory the note itself last named, for a checkout
   * the runner no longer remembers.
   */
  deleteNote(repoPath: string, noteId: string, worktree: string | null): Promise<void>

  /** Whether this repo can open PRs at all, and where. */
  forge(repoPath: string): Promise<Forge>

  /** Push the branch and open a PR for it. Rejects with `gh`'s reason. */
  openPr(repoPath: string, branch: string, title: string, body: string, draft: boolean): Promise<PullRequest>

  // -------------------------------------------------------------------------
  // A board's repository, and the disk it lives on.
  // -------------------------------------------------------------------------

  /** Inspect a path — `~` and all — before offering to make a board of it. */
  checkRepo(path: string): Promise<RepoCheck>

  /** Every checkout these notes still hold, removed along with its branch. */
  removeBoard(repoPath: string, noteIds: string[]): Promise<void>

  /** Tracked paths for the composer's `@` picker; `error` when git could not say. */
  files(repoPath: string): Promise<{ files: string[]; dirs: string[]; error?: string }>

  /** Skills in the repository, and which of them git would carry. */
  skills(repoPath: string): Promise<SkillInfo[]>
  addSkills(repoPath: string, source: string, skill?: string): Promise<SkillInfo[]>
  removeSkill(repoPath: string, name: string): Promise<SkillInfo[]>
  commitSkills(repoPath: string): Promise<{ committed: string[]; skills: SkillInfo[] }>

  /** A directory listing for the repo picker; null means home. */
  browse(path: string | null): Promise<Listing>

  /** The OS folder chooser, where the platform has one. */
  pick(): Promise<{ path: string | null; supported: boolean }>

  // -------------------------------------------------------------------------
  // Agents — facts about this machine's CLIs, not about any board.
  // -------------------------------------------------------------------------

  /** Installed agents, corrected by what their runs actually did. */
  agents(): Promise<AgentInfo[]>

  /** A menu for the model pickers. */
  models(agent: string): Promise<string[]>

  /** Replace the models you added yourself. Resolves to the new list. */
  setModels(agent: string, ids: string[]): Promise<string[]>

  /** A default model for each installed agent, for a board being created. */
  defaultModels(): Promise<Record<string, string>>
}

/**
 * A diff read from the checkout itself.
 *
 * `baseBranch` is where "merge here" would put it, so the confirmation can say
 * so. A snapshot replayed from the log has no such thing.
 */
export type LiveDiff = { diff: string; stat: string; branch: string; baseBranch: string | null }

/**
 * What a review decided, with what a merge commit needs to say.
 *
 * The words come from the board — the note, the run, whether it asked to be
 * signed — so the route composes them and the workshop only writes them into
 * git.
 */
export type Verdict =
  | {
      decision: "merge"
      land: {
        note: { id: string; title: string; body: string }
        facts: { stat: DiffStat | null; agent: AgentId | null; model: string | null; turns: number | null }
        trailers: string[]
      }
    }
  | { decision: "discard" }

/**
 * What became of the checkout.
 *
 * - `none`: the runner held no checkout for the note, so there was nothing to do.
 * - `conflict`: the merge did not apply. Nothing was touched.
 * - `removed`: the checkout is gone, which the log should hear about.
 * - `kept`: it could not be retired safely, and `reason` says why.
 */
export type Reviewed =
  | { checkout: "none" }
  | { checkout: "conflict"; branch: string; conflict: string }
  | { checkout: "removed" }
  | { checkout: "kept"; reason: string }
