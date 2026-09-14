import type { AgentId, Attribution, Board, BoardView, Policy, PullRequest } from "./domain.js"
import type { TranscriptFrame } from "./events.js"
import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

/**
 * The wire contract. The server validates against it, clients are typed from
 * it. Both opencode and t3code converged on a shared contracts package as
 * their anti-drift mechanism; this is ours.
 */
export type Commands = {
  "POST /boards": {
    req: {
      name?: string
      repoPath: string
      setup?: string | null
      carry?: string[]
      defaultPolicy?: Policy
    }
    res: { board: Board }
  }
  "POST /boards/:id/setup": { req: { setup: string | null; carry?: string[] }; res: {} }
  /** Forget a board. Notes go with it; the repository does not. */
  "POST /boards/:id/remove": { req: {}; res: {} }
  "POST /notes": {
    req: {
      boardId: BoardId
      columnId: ColumnId
      title: string
      body?: string
      /** Base64. Staged under the new note's id until it has a worktree. */
      files?: UploadFile[]
    }
    res: { noteId: NoteId; attachments: StagedFile[]; rejected: Rejection[] }
  }
  /** Attach to an existing note — its worktree if it has one, the stage if not. */
  "POST /notes/:id/attach": {
    req: { files: UploadFile[] }
    res: { attachments: StagedFile[]; rejected: Rejection[] }
  }
  "POST /notes/:id/unattach": { req: { name: string }; res: { attachments: StagedFile[] } }
  "POST /notes/:id/edit": { req: { title?: string; body?: string }; res: {} }
  "POST /notes/:id/move": { req: { columnId: ColumnId; before?: NoteId; after?: NoteId }; res: {} }
  "POST /notes/:id/assign": { req: { agent: AgentId }; res: {} }
  "POST /notes/:id/policy": { req: { policy: Policy }; res: {} }
  "POST /notes/:id/model": { req: { model: string | null }; res: {} }
  "POST /boards/:id/models": { req: { models: Record<string, string> }; res: {} }
  /** What notes created on this board start as. */
  "POST /boards/:id/policy": { req: { defaultPolicy: Policy }; res: {} }
  /**
   * Raise this note to full access and continue it.
   *
   * The blunt instrument, kept deliberately: not an answer to one question
   * (that is `POST /runs/:id/respond`) but a decision about the whole note,
   * made after the fact. Still the right call for an agent that cannot be
   * asked, or a run you have stopped wanting to be asked about.
   */
  "POST /notes/:id/escalate": { req: {}; res: { delivery: Delivery } }
  /** Turn commit trailers and the PR footer on or off, independently. */
  "POST /boards/:id/attribution": { req: { attribution: Partial<Attribution> }; res: {} }
  /** Push the note's branch and open a PR for it. */
  "POST /notes/:id/pr": { req: { draft?: boolean }; res: { pr: PullRequest } }
  "POST /notes/:id/delete": { req: {}; res: {} }
  "POST /notes/:id/run": { req: { agent?: AgentId }; res: { runId: RunId } }
  "POST /notes/:id/review": {
    req: { decision: "merge" | "discard" | "revise"; comment?: string }
    res: {}
  }
  "POST /runs/:id/cancel": { req: {}; res: {} }
  /** Steer a note: talk to the live agent, or queue a follow-up that resumes it. */
  "POST /notes/:id/message": {
    req: { text: string; files?: UploadFile[] }
    res: { delivery: Delivery; rejected: Rejection[] }
  }
  /**
   * Answer a question an agent is standing still waiting for.
   *
   * The three options a terminal already trains people to expect: allow once
   * (`decision: "allow"`), allow this kind of thing for this note and stop
   * asking (`scope: "note"`), and deny with a message saying what to do
   * instead (`comment`). The third is why this is better than a policy
   * toggle — "no, run the tests with pnpm not npm" is an answer, and bare
   * "deny" is not.
   *
   * `answered` is false when there was nothing left to answer: the run ended,
   * the question timed out, or another client got there first. Not an error —
   * two tabs on one board is the normal case.
   */
  "POST /runs/:id/respond": {
    req: {
      requestId: string
      decision: "allow" | "deny"
      scope?: "once" | "note"
      comment?: string
    }
    res: { answered: boolean }
  }
  /**
   * The agent asking, through the MCP sidecar kandy points it at. Held open
   * until the question is answered or times out — minutes, not milliseconds.
   * Never called by a UI.
   */
  "POST /runs/:id/permission": {
    req: { tool: string; input?: Record<string, unknown> }
    res: {
      verdict:
        | { behavior: "allow"; updatedInput: Record<string, unknown> }
        | { behavior: "deny"; message: string }
    }
  }
}

export type Queries = {
  "GET /health": { res: { version: string; uptime: number; pid: number } }
  "GET /boards": { res: { boards: Board[] } }
  "GET /boards/:id/view": { res: BoardView }
  "GET /agents": { res: { agents: AgentInfo[] } }
  /** Model ids this agent can plausibly run. */
  "GET /agents/:id/models": { res: { models: string[] } }
  "GET /runs/:id/output": { res: { lines: OutputLine[]; nextAfter: number | null } }
  "GET /runs/:id/transcript": { res: { frames: TranscriptFrame[]; nextAfter: number | null } }
  /**
   * `capturedAt` is null for a diff read live from the worktree, and the time
   * of the snapshot for one replayed after the worktree was removed.
   */
  "GET /notes/:id/diff": {
    res: { diff: string; stat: string; branch: string | null; capturedAt: number | null }
  }
  /** Validate a path before offering to make a board of it. */
  "GET /repo/check": { res: RepoCheck }
  /** Whether this board's repo can open PRs at all, and where. */
  "GET /boards/:id/forge": { res: Forge }
  /** Directory listing, for choosing a repo without typing a path. */
  "GET /repo/browse": { res: Listing }
  /** Files waiting for this note's worktree. Empty once it has run. */
  "GET /notes/:id/attachments": { res: { attachments: StagedFile[] } }
}

/** A file on its way to an agent. Base64 so the payload stays plain JSON. */
export type UploadFile = { name: string; data: string }

/** A file held for a note, named as the agent will see it. */
export type StagedFile = { name: string; bytes: number }

/**
 * A file we would not take, and why.
 *
 * Said out loud rather than dropped: a screenshot that quietly never arrives
 * looks exactly like an agent ignoring it.
 */
export type Rejection = { name: string; reason: string }

/**
 * How a steering message reached the agent. Surfaced to the user because the
 * difference matters: "live" lands mid-turn, "queued" starts a new run.
 */
export type Delivery = "live" | "queued"

export type AgentInfo = {
  id: AgentId
  installed: boolean
  /** Signed in *and* not expired. A stale credential is not usable. */
  authed: boolean
  version: string | null
  /**
   * When the sign-in stops working, if the CLI records it.
   *
   * Claude Code writes `refreshTokenExpiresAt`; once that passes you have to
   * sign in again, and until kandy read it a month-dead credential still
   * showed as ready — you found out when a run failed. Codex records no expiry,
   * so this stays null there and absence means "it did not say", never "fine".
   */
  expiresAt: number | null
  /**
   * How the agent is paid for: a plan name, or "api" for a key.
   *
   * On a subscription there is no per-token bill, which is what makes every
   * figure on the Usage page notional.
   */
  plan: string | null
  /**
   * When a run last failed to authenticate with this agent, if one has.
   *
   * Outranks everything above it. A credential file is a guess — the CLI's own
   * init succeeds on cached credentials — so a run that actually tried and was
   * refused is the only certain evidence, and it sets `authed` false whatever
   * the file says.
   */
  authFailedAt: number | null
}

export type OutputLine = {
  seq: number
  ts: number
  channel: "stdout" | "stderr"
  text: string
}

/**
 * Every command returns the sequence number of the event it produced. A client
 * wanting read-your-writes waits for that seq on the event stream rather than
 * optimistically merging a response body — one code path for all state change.
 */
export type Ok<T> = { ok: true; seq: number } & T
export type Err = { ok: false; error: { code: ErrorCode; message: string; detail?: unknown } }

export type RepoCheck = {
  /** A sensible setup command guessed from the repo's lockfiles. */
  suggestedSetup: string | null
  /** Gitignored paths worth carrying into a worktree, found in the repo. */
  suggestedCarry: string[]
  path: string
  exists: boolean
  isRepo: boolean
  /** Uncommitted changes — notes branch from HEAD and won't see them. */
  dirty: boolean
  head: string | null
  branch: string | null
  name: string | null
  error: string | null
}

/** What we know about the repo's hosting, for the PR affordances. */
export type DirEntry = {
  name: string
  path: string
  isRepo: boolean
}

export type Listing = {
  path: string
  parent: string | null
  entries: DirEntry[]
  isRepo: boolean
  /** Places repos usually live, so the picker opens somewhere useful. */
  suggestions: DirEntry[]
}

export type Stats = {
  board: { name: string; repoPath: string }
  notes: { total: number; landed: number; discarded: number; open: number; failed: number }
  runs: { total: number; medianMs: number | null; longest: { ms: number; title: string } | null }
  spend: { usd: number; estimated: boolean; tokens: number; unpricedRuns: number }
  code: { insertions: number; deletions: number; files: number }
  firstTry: { landed: number; of: number }
  linesPerDollar: number | null
  tokensPerLine: number | null
  busiestHour: { hour: number; runs: number } | null
  priciest: { usd: number; title: string; estimated: boolean } | null
  agents: {
    agent: string
    landed: number
    discarded: number
    runs: number
    usd: number
    estimated: boolean
    medianMs: number | null
  }[]
  tools: { tool: string; calls: number }[]
  /** Runs per day, oldest first, for the activity map. */
  daily: { date: string; runs: number }[]
  /** Runs started in each hour, 0–23. */
  hours: number[]
  /**
   * Where work goes, and where it stops.
   *
   * The one shape only kandy can draw: written → run → reviewed → landed, with
   * what fell out at each step.
   */
  funnel: { written: number; ran: number; reviewed: number; landed: number; lost: number }
}

export type Forge = {
  /** gh is installed and authenticated. */
  available: boolean
  /** e.g. "hiteshbandhu/kandy". */
  repo: string | null
  defaultBranch: string | null
  reason: string | null
}

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "board_not_found",
  "note_not_found",
  "run_not_found",
  "agent_not_available",
  "repo_dirty",
  "worktree_failed",
  "not_a_repo",
  "no_forge",
  "no_branch",
  "run_not_live",
  "invalid_transition",
  "internal",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
