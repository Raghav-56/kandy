import type { McpServer } from "./capabilities.js"
import type { PermissionPrompt, PermissionRule } from "./permission.js"
import type { BoardId, ColumnId, NoteId, RunId } from "./id.js"

export const AGENTS = ["claude", "codex", "aider", "cursor", "opencode", "gemini", "grok"] as const
export type AgentId = (typeof AGENTS)[number]

/**
 * `blocked` is the only status that legitimately demands attention. Every
 * client should treat it as such — it is the difference between a board you
 * can walk away from and one you have to watch.
 */
export const NOTE_STATUSES = [
  "draft",
  "queued",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
] as const
export type NoteStatus = (typeof NOTE_STATUSES)[number]

export type RunStatus =
  | "starting"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"

/**
 * How much the agent is allowed to do.
 *
 * A worktree bounds what an agent can damage *inside the repo*. It does not
 * stop it touching $HOME, the network, or anything else on the machine — so
 * this is the user's decision to make, per note, with the tradeoff stated
 * plainly rather than a flag we quietly set for them.
 *
 * `repo`  — edit files freely; anything else is put to you as a question, if
 *           the agent can be asked (see `ASK_CAPABLE`), and refused and
 *           surfaced if it cannot.
 * `full`  — run anything. Fast and unblocked; only for work you'd have run
 *           yourself without reading it first.
 */
export type Policy = "repo" | "full"

/**
 * Whether kandy signs the history it produces.
 *
 * Two switches rather than one, because they are not the same decision. A
 * commit trailer is permanent: it is in the history forever, it is what
 * `git log --format=%(trailers)` and DCO/commit-lint checks read, and it
 * survives every rebase of that commit. A PR footer is a paragraph in a
 * description anyone can edit or delete.
 *
 * Both default off. Tools that turned this on for people without asking
 * (opencode shipped it unconditionally and spent three issues walking it
 * back) taught us that writing someone's history uninvited is not a default
 * to claim. When both are false kandy behaves exactly as it did before this
 * existed — no trailers, no footer, not even empty ones.
 */
export type Attribution = {
  /** Git trailers on the commits kandy makes: leftovers, and the merge. */
  commit: boolean
  /** A short footer on PR bodies kandy opens. */
  pr: boolean
}

/** The default, and what an older log with no attribution event replays to. */
export const NO_ATTRIBUTION: Attribution = { commit: false, pr: false }

export type Board = {
  id: BoardId
  name: string
  repoPath: string
  /**
   * Shell run in a fresh worktree before the agent starts.
   *
   * A new worktree has no node_modules, no .env, no build cache — so an agent
   * can write a test and then be unable to run it. This is how a board says
   * what "ready to work" means for its repo.
   */
  setup: string | null
  /**
   * Gitignored paths cloned into each new worktree — `.env`, build caches.
   *
   * pnpm already handles node_modules cheaply (its store clones by reference
   * on APFS, which is why a fresh install is sub-second), but nothing handles
   * the secrets and caches git deliberately doesn't track. Copied by reference
   * where the filesystem supports it, so this is close to free.
   */
  carry: string[]
  /** Default model per agent, e.g. { claude: "opus", codex: "gpt-6-astra" }. */
  models: Partial<Record<AgentId, string>>
  /**
   * What a new note on this board starts as. `repo` unless someone says
   * otherwise.
   *
   * Per board, not per install, because it is a judgement about one
   * repository's blast radius: a scratch repo and an employer's do not deserve
   * the same answer, and a single global switch would force one.
   */
  defaultPolicy: Policy
  /** Whether commits and PRs say kandy made them. Off unless asked for. */
  attribution: Attribution
  /**
   * MCP servers every agent on this board is given, in its own dialect.
   *
   * On the board rather than in each agent's config so that one list reaches
   * all of them, and travels with the board. See `capabilities.ts`.
   */
  mcp: McpServer[]
  createdAt: number
}

/**
 * Lanes of the lifecycle. A column may declare which lane it represents, and
 * the server then moves notes into it as their status changes — a board whose
 * cards say REVIEW while sitting in Inbox is lying about the only thing it
 * exists to show.
 *
 * Columns without a lane are just user-made groupings; nothing moves into them
 * automatically.
 */
export type Lane = "inbox" | "queued" | "running" | "review" | "done"

export const LANE_OF: Record<NoteStatus, Lane> = {
  draft: "inbox",
  queued: "queued",
  running: "running",
  // Blocked work stays where the eye already is — beside what's in flight.
  blocked: "running",
  review: "review",
  // A failure is a thing to look at, not a thing to file away.
  failed: "review",
  done: "done",
}

export type Column = {
  id: ColumnId
  boardId: BoardId
  name: string
  pos: string
  lane: Lane | null
}

export type Note = {
  id: NoteId
  boardId: BoardId
  columnId: ColumnId
  /** Short name for the note. Shown in the list; also given to the agent. */
  title: string
  /**
   * The detail: constraints, acceptance criteria, links, anything the agent
   * needs beyond the one-line task. Optional — a title alone is a valid note.
   */
  body: string
  status: NoteStatus
  pos: string
  agent: AgentId | null
  /** Pinned model, or null to use the board default for the chosen agent. */
  model: string | null
  policy: Policy
  /**
   * Standing answers to permission prompts, for this note only.
   *
   * Written by "don't ask me again" while unblocking a run. Deliberately not
   * inherited from the board and never copied to it: a board-wide rule is a
   * bigger decision than someone makes in the middle of one job.
   */
  rules: PermissionRule[]
  runId: RunId | null
  /** Set when a run starts; the deliverable. */
  branch: string | null
  worktree: string | null
  /** What this note changed. Survives review, unlike the worktree. */
  stat: DiffStat | null
  /** The PR opened from this note's branch, if there is one. */
  pr: PullRequest | null
  /**
   * How a finished note ended.
   *
   * Both verdicts leave a note `done`, which made "landed" and "thrown away"
   * indistinguishable — and any accept rate computed from status alone would
   * have been flattering nonsense.
   */
  outcome: Outcome | null
  createdAt: number
  updatedAt: number
}

/** Parsed `git diff --shortstat`, so the UI can draw it rather than print it. */
export type DiffStat = {
  files: number
  insertions: number
  deletions: number
}

/**
 * A pull request opened from a note's branch.
 *
 * Merging locally is only half a workflow — most teams review on the forge.
 * A note that produced a branch should be able to say "and here is the PR",
 * including whether CI is happy with it, without anyone leaving the board.
 */
export type PullRequest = {
  number: number
  url: string
  title: string
  /** GitHub's own vocabulary, lowercased: open | merged | closed. */
  state: "open" | "merged" | "closed"
  draft: boolean
  /** Rolled-up CI state, or null when the forge reports none yet. */
  checks: "passing" | "failing" | "pending" | null
  /** Review decision, when one has been given. */
  review: "approved" | "changes_requested" | "review_required" | null
  updatedAt: number
}

export type Run = {
  id: RunId
  noteId: NoteId
  agent: AgentId
  /** The agent CLI's own session id, captured from its stream. Needed for resume. */
  agentSessionId: string | null
  status: RunStatus
  /** Commit the worktree branched from, resolved at queue time and never re-resolved. */
  baseRef: string | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error: string | null
  /** What the turn cost. Null when we can neither read nor price it. */
  costUsd: number | null
  tokens: number | null
  turns: number | null
  /** The model that actually ran, when the agent tells us. */
  model: string | null
  /**
   * Where the cost figure came from.
   *
   * Claude reports dollars directly; Codex reports only tokens, so its cost is
   * computed from a price table and is an estimate. Tracking which is which
   * means the UI can say precisely how much of a total is uncertain instead of
   * disclaiming the whole number.
   */
  costSource: CostSource
}

export type CostSource = "reported" | "estimated" | "unpriced"

export type Outcome = "merged" | "discarded"

/** What a client renders. A projection of the event log, never written directly. */
export type BoardView = {
  board: Board
  columns: Column[]
  notes: Note[]
  runs: Run[]
  /**
   * Agents standing still, waiting for an answer.
   *
   * The most urgent thing a board can contain — more urgent than `blocked`,
   * which means "it was refused and carried on". Empty almost always; when it
   * isn't, it goes above everything else.
   */
  prompts: PermissionPrompt[]
  /** Sequence number this view reflects; the client streams from here. */
  seq: number
}

/**
 * What the agent is actually told to do.
 *
 * Title and detail are two fields, and the agent receives both. The previous
 * `body ?? title` lost the title whenever a detail existed — and since `??`
 * does not treat an empty string as absent, a note written as a single line
 * sent the agent nothing at all.
 */
export function promptFor(note: { title: string; body: string }): string {
  return [note.title.trim(), note.body.trim()].filter(Boolean).join("\n\n")
}

/**
 * The inverse of `promptFor`: a blob of prose becomes a titled note.
 *
 * Pasting three paragraphs into a single-line title used to keep the first
 * line's worth of characters and drop the rest on the floor. A note already
 * *is* a first line plus a remainder — that is exactly how `promptFor` puts one
 * back together — so a paste splits the same way round rather than inventing a
 * second convention for the same shape.
 */
export function splitPrompt(text: string): { title: string; body: string } {
  const normalised = text.replace(/\r\n?/g, "\n")
  const nl = normalised.indexOf("\n")
  if (nl === -1) return { title: normalised.trim(), body: "" }
  return {
    title: normalised.slice(0, nl).trim(),
    // Only the blank line that `promptFor` inserted is eaten; interior
    // paragraph breaks are the paste's own formatting and are left alone.
    body: normalised.slice(nl + 1).replace(/^\n+/, "").trimEnd(),
  }
}
