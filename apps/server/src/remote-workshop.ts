import type { ActorId, AgentId, AgentInfo } from "@kandy/core"
import type { Engine } from "./engine.js"
import type { Runners } from "./hub.js"
import { status } from "./hub.js"
import type { Workshop } from "./workshop.js"

/**
 * The workshop, for a hub that has no repositories of its own.
 *
 * Every method is a command to a runner. Which one is the whole of this file,
 * and the rule is short:
 *
 * - **About a note** → the runner it is placed on. That machine has the
 *   checkout, and no other does.
 * - **A note with no place yet** → the caller's own runner, and the note is
 *   placed there first. Your note runs on your machine unless it is given to
 *   someone else; that is the premise, not a default.
 * - **About a repository** → a runner that has it, the caller's own first.
 * - **About a disk** — browse, pick, check a path → the caller's own runner.
 *   Nobody gets to look around someone else's home directory.
 *
 * Built per request, because "the caller's own" needs to know who is calling.
 */
export class RemoteWorkshop implements Workshop {
  constructor(
    private readonly engine: Engine,
    private readonly runners: Runners,
    /** Who is asking. Null on a hub with no identity, where there is one person. */
    private readonly actor: ActorId | null,
  ) {}

  // ── routing ─────────────────────────────────────────────────────────────

  /** The runner holding this note, or a 409 that says none does. */
  private placed(noteId: string): string {
    const runnerId = this.runners.placement(noteId)
    if (!runnerId) throw status(409, "this note has not been run anywhere yet")
    return runnerId
  }

  /** Where a note should go when it has no place: the caller's own machine. */
  private home(boardId: string): string {
    const r = this.runners.pick(boardId, this.actor)
    if (!r) {
      throw status(
        503,
        this.actor
          ? `none of your machines with this repository is connected — run \`kandy runner\` on one`
          : "no runner with this repository is connected",
      )
    }
    return r.runnerId
  }

  private boardOfNote(noteId: string): string {
    const view = this.engine.boardOf(noteId)
    if (!view) throw status(404, "no such note")
    return view.board.id
  }

  private boardOfRepo(repoPath: string): string {
    const b = this.engine.projections.boards().find((x) => x.repoPath === repoPath)
    if (!b) throw status(404, "no board for that repository")
    return b.id
  }

  /** Placed, or placed now on the caller's own runner. */
  private placeOrHome(noteId: string): string {
    const existing = this.runners.placement(noteId)
    if (existing) return existing
    const runnerId = this.home(this.boardOfNote(noteId))
    this.runners.place(noteId, runnerId, this.actor)
    return runnerId
  }

  /** The caller's own connected runner, for anything about a disk. */
  private own(): string {
    const mine = this.runners.list().find((r) => r.online && r.owner === this.actor)
    if (!mine) throw status(503, "none of your machines is connected — run `kandy runner` on one")
    return mine.runnerId
  }

  private call<T>(runnerId: string, op: string, args: unknown[]): Promise<T> {
    return this.runners.call<T>(runnerId, op, args)
  }

  // ── run control ─────────────────────────────────────────────────────────

  /**
   * Run a note, on the machine it belongs to.
   *
   * The requester travels with the command, because the runner — not the
   * hub — decides whether to accept work from them. An empty run id back
   * means it was held for its owner to answer; the note says so on the board.
   */
  request(boardId: string, noteId: string, agent: AgentId): Promise<string> {
    return this.call(this.placeOrHome(noteId), "request", [boardId, noteId, agent, this.actor])
  }

  steer(boardId: string, noteId: string, text: string) {
    return this.call<Awaited<ReturnType<Workshop["steer"]>>>(this.placed(noteId), "steer", [boardId, noteId, text])
  }

  escalate(boardId: string, noteId: string) {
    return this.call<Awaited<ReturnType<Workshop["escalate"]>>>(this.placed(noteId), "escalate", [boardId, noteId])
  }

  async cancel(runId: string): Promise<boolean> {
    for (const b of this.engine.projections.boards()) {
      const run = this.engine.view(b.id)?.runs.find((r) => r.id === runId)
      if (run) return this.call(this.placed(run.noteId), "cancel", [runId])
    }
    return false
  }

  async syncColumn(boardId: string, noteId: string): Promise<void> {
    // A note that has never been anywhere has no lane a runner decided; its
    // column is whatever people put it in.
    const runnerId = this.runners.placement(noteId)
    if (runnerId) await this.call(runnerId, "syncColumn", [boardId, noteId])
  }

  // ── a note's workspace ──────────────────────────────────────────────────

  stage(noteId: string, files: Parameters<Workshop["stage"]>[1]) {
    // Attachments wait where the note will run, so they are already there.
    return this.call<Awaited<ReturnType<Workshop["stage"]>>>(this.placeOrHome(noteId), "stage", [noteId, files])
  }

  async staged(noteId: string) {
    const runnerId = this.runners.placement(noteId)
    return runnerId ? this.call<Awaited<ReturnType<Workshop["staged"]>>>(runnerId, "staged", [noteId]) : []
  }

  unattach(noteId: string, name: string) {
    return this.call<Awaited<ReturnType<Workshop["unattach"]>>>(this.placed(noteId), "unattach", [noteId, name])
  }

  attach(noteId: string, files: Parameters<Workshop["attach"]>[1]) {
    return this.call<Awaited<ReturnType<Workshop["attach"]>>>(this.placeOrHome(noteId), "attach", [noteId, files])
  }

  messageFiles(noteId: string, files: Parameters<Workshop["messageFiles"]>[1]) {
    return this.call<Awaited<ReturnType<Workshop["messageFiles"]>>>(this.placed(noteId), "messageFiles", [noteId, files])
  }

  handoff(repoPath: string, noteId: string) {
    return this.call<{ branch: string }>(this.placed(noteId), "handoff", [repoPath, noteId])
  }

  async diff(noteId: string) {
    // No place, no checkout, no live diff: the hub's saved snapshot answers.
    const runnerId = this.runners.placement(noteId)
    if (!runnerId || !this.runners.get(runnerId)?.online) return null
    return this.call<Awaited<ReturnType<Workshop["diff"]>>>(runnerId, "diff", [noteId])
  }

  review(repoPath: string, noteId: string, verdict: Parameters<Workshop["review"]>[2]) {
    return this.call<Awaited<ReturnType<Workshop["review"]>>>(this.placed(noteId), "review", [repoPath, noteId, verdict])
  }

  async deleteNote(repoPath: string, noteId: string, worktree: string | null): Promise<void> {
    const runnerId = this.runners.placement(noteId)
    if (runnerId) await this.call(runnerId, "deleteNote", [repoPath, noteId, worktree])
  }

  // ── a repository ────────────────────────────────────────────────────────

  private repo(repoPath: string): string {
    return this.home(this.boardOfRepo(repoPath))
  }

  forge(repoPath: string) {
    return this.call<Awaited<ReturnType<Workshop["forge"]>>>(this.repo(repoPath), "forge", [repoPath])
  }

  openPr(repoPath: string, branch: string, title: string, body: string, draft: boolean) {
    // The branch is pushed from the machine that has it, with that person's
    // own git credentials. The hub never holds a forge token.
    const note = this.engine.projections
      .boards()
      .flatMap((b) => this.engine.view(b.id)?.notes ?? [])
      .find((n) => n.branch === branch)
    const runnerId = note ? this.placed(note.id) : this.repo(repoPath)
    return this.call<Awaited<ReturnType<Workshop["openPr"]>>>(runnerId, "openPr", [repoPath, branch, title, body, draft])
  }

  checkRepo(path: string) {
    return this.call<Awaited<ReturnType<Workshop["checkRepo"]>>>(this.own(), "checkRepo", [path])
  }

  async removeBoard(repoPath: string, noteIds: string[]): Promise<void> {
    // Every runner that holds any of these notes tidies its own checkouts.
    const by = new Map<string, string[]>()
    for (const n of noteIds) {
      const r = this.runners.placement(n)
      if (r) by.set(r, [...(by.get(r) ?? []), n])
    }
    await Promise.all([...by].map(([r, ids]) => this.call(r, "removeBoard", [repoPath, ids]).catch(() => {})))
  }

  files(repoPath: string) {
    return this.call<Awaited<ReturnType<Workshop["files"]>>>(this.repo(repoPath), "files", [repoPath])
  }

  skills(repoPath: string) {
    return this.call<Awaited<ReturnType<Workshop["skills"]>>>(this.repo(repoPath), "skills", [repoPath])
  }

  addSkills(repoPath: string, source: string, skill?: string) {
    return this.call<Awaited<ReturnType<Workshop["addSkills"]>>>(this.repo(repoPath), "addSkills", [repoPath, source, skill])
  }

  removeSkill(repoPath: string, name: string) {
    return this.call<Awaited<ReturnType<Workshop["removeSkill"]>>>(this.repo(repoPath), "removeSkill", [repoPath, name])
  }

  commitSkills(repoPath: string) {
    return this.call<Awaited<ReturnType<Workshop["commitSkills"]>>>(this.repo(repoPath), "commitSkills", [repoPath])
  }

  // ── a disk ──────────────────────────────────────────────────────────────

  browse(path: string | null) {
    return this.call<Awaited<ReturnType<Workshop["browse"]>>>(this.own(), "browse", [path])
  }

  pick() {
    return this.call<Awaited<ReturnType<Workshop["pick"]>>>(this.own(), "pick", [])
  }

  // ── agents ──────────────────────────────────────────────────────────────

  /** What can run somewhere on this hub — from hellos, with no round trip. */
  async agents(): Promise<AgentInfo[]> {
    return this.runners.agents()
  }

  models(agent: string) {
    return this.call<string[]>(this.anyOrOwn(), "models", [agent])
  }

  setModels(agent: string, ids: string[]) {
    return this.call<string[]>(this.own(), "setModels", [agent, ids])
  }

  async defaultModels(): Promise<Record<string, string>> {
    const r = this.runners.list().find((x) => x.online)
    return r ? this.call(r.runnerId, "defaultModels", []) : {}
  }

  private anyOrOwn(): string {
    const online = this.runners.list().filter((r) => r.online)
    const mine = online.find((r) => r.owner === this.actor)
    const r = mine ?? online[0]
    if (!r) throw status(503, "no runner is connected")
    return r.runnerId
  }
}
