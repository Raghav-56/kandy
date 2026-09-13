import type {
  ActivityFrame,
  AgentId,
  AgentInfo,
  Board,
  BoardView,
  Delivery,
  Forge,
  KandyEvent,
  Listing,
  OutputLine,
  Policy,
  PullRequest,
  RepoCheck,
  Stats,
  StreamFrame,
  TranscriptFrame,
} from "@kandy/core"
import { installEventSource } from "./sse.js"

export { installEventSource, NodeEventSource, SseDecoder, type SseMessage } from "./sse.js"

export type ClientOptions = {
  baseUrl?: string
  token?: string | (() => string | Promise<string>)
}

export class KandyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = "KandyError"
  }
}

/**
 * Typed client for the server API. Shared by the web app and the TUI —
 * neither client gets its own copy of the wire format.
 */
export class KandyClient {
  private baseUrl: string
  private token: ClientOptions["token"]

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://127.0.0.1:4477").replace(/\/$/, "")
    this.token = opts.token
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = method === "GET" || method === "HEAD" ? undefined
      : typeof this.token === "function" ? await this.token() : this.token
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = (await res.json()) as unknown
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; detail?: unknown } }).error
      throw new KandyError(e?.code ?? "internal", e?.message ?? res.statusText, e?.detail)
    }
    return json as T
  }

  health() {
    return this.req<{ version: string; uptime: number; pid: number }>("GET", "/health")
  }
  agents() {
    return this.req<{ agents: AgentInfo[] }>("GET", "/agents")
  }
  models(agent: string) {
    return this.req<{ models: string[] }>("GET", `/agents/${agent}/models`)
  }
  boards() {
    return this.req<{ boards: Board[] }>("GET", "/boards")
  }
  browse(path?: string) {
    const q = path ? `?path=${encodeURIComponent(path)}` : ""
    return this.req<Listing>("GET", `/repo/browse${q}`)
  }
  /** Opens the OS folder chooser on the machine running the daemon. */
  pickFolder() {
    return this.req<{ path: string | null; supported: boolean }>("POST", "/repo/pick", {})
  }
  checkRepo(path: string) {
    return this.req<RepoCheck>("GET", `/repo/check?path=${encodeURIComponent(path)}`)
  }
  createBoard(name: string, repoPath: string, setup?: string | null, carry?: string[]) {
    return this.req<{ board: Board; seq: number }>("POST", "/boards", {
      name,
      repoPath,
      setup,
      carry,
    })
  }
  setBoardSetup(boardId: string, setup: string | null, carry?: string[]) {
    return this.req<{ seq: number }>("POST", `/boards/${boardId}/setup`, { setup, carry })
  }
  view(boardId: string) {
    return this.req<BoardView>("GET", `/boards/${boardId}/view`)
  }

  createNote(boardId: string, columnId: string, title: string, body = "") {
    return this.req<{ noteId: string; seq: number }>("POST", "/notes", {
      boardId,
      columnId,
      title,
      body,
    })
  }
  editNote(noteId: string, patch: { title?: string; body?: string }) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/edit`, patch)
  }
  /** Say which neighbours it lands between; the server computes the key. */
  moveNote(noteId: string, columnId: string, neighbours: { after?: string; before?: string } = {}) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/move`, { columnId, ...neighbours })
  }
  assignNote(noteId: string, agent: AgentId) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/assign`, { agent })
  }
  stats(boardId: string) {
    return this.req<Stats>("GET", `/boards/${boardId}/stats`)
  }
  forge(boardId: string) {
    return this.req<Forge>("GET", `/boards/${boardId}/forge`)
  }
  openPr(noteId: string, draft = false) {
    return this.req<{ pr: PullRequest; seq: number }>("POST", `/notes/${noteId}/pr`, { draft })
  }
  setModel(noteId: string, model: string | null) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/model`, { model })
  }
  removeBoard(boardId: string) {
    return this.req<{ seq: number }>("POST", `/boards/${boardId}/remove`, {})
  }
  setBoardModels(boardId: string, models: Record<string, string>) {
    return this.req<{ seq: number }>("POST", `/boards/${boardId}/models`, { models })
  }
  setPolicy(noteId: string, policy: Policy) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/policy`, { policy })
  }
  deleteNote(noteId: string) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/delete`, {})
  }
  runNote(noteId: string, agent?: AgentId) {
    return this.req<{ runId: string; seq: number }>("POST", `/notes/${noteId}/run`, { agent })
  }
  reviewNote(noteId: string, decision: "merge" | "discard" | "revise", comment?: string) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/review`, { decision, comment })
  }
  /** Steer a note: reaches a live agent if it takes stdin, else queues a follow-up. */
  message(noteId: string, text: string, files?: { name: string; data: string }[]) {
    return this.req<{ delivery: Delivery; seq: number }>("POST", `/notes/${noteId}/message`, {
      text,
      files,
    })
  }
  diff(noteId: string) {
    return this.req<{
      diff: string
      stat: string
      branch: string | null
      /** Where a local merge would land it. Null once the worktree is gone. */
      baseBranch: string | null
      /** Non-null when the worktree is gone and this is the review-time snapshot. */
      capturedAt: number | null
    }>(
      "GET",
      `/notes/${noteId}/diff`,
    )
  }
  transcript(runId: string, after = 0) {
    return this.req<{ frames: TranscriptFrame[]; nextAfter: number | null }>(
      "GET",
      `/runs/${runId}/transcript?after=${after}`,
    )
  }
  cancelRun(runId: string) {
    return this.req<{ seq: number }>("POST", `/runs/${runId}/cancel`, {})
  }
  output(runId: string, after = 0) {
    return this.req<{ lines: OutputLine[]; nextAfter: number | null }>(
      "GET",
      `/runs/${runId}/output?after=${after}`,
    )
  }

  /**
   * Subscribe to the event stream. Returns an unsubscribe function.
   *
   * EventSource handles reconnect and Last-Event-ID for us, which is most of
   * why the transport is SSE rather than a WebSocket we'd have to babysit.
   *
   * Node has no global EventSource on the versions we support, so install the
   * polyfill here rather than making every CLI caller remember to. It is a
   * no-op in the browser and on any runtime that ships a real one.
   */
  events(
    after: number,
    handlers: {
      onEvent: (e: KandyEvent) => void
      onError?: (e: Event) => void
      onTranscript?: (f: TranscriptFrame) => void
      onActivity?: (f: ActivityFrame) => void
    },
  ): () => void {
    // baseUrl may be relative ("/api" behind a dev proxy), which `new URL`
    // rejects without a base. Resolve against the page origin when there is
    // one; fall back to a bare string for non-browser callers.
    const origin = globalThis.location?.origin
    const url = origin
      ? new URL(this.baseUrl + "/events", origin)
      : new URL(this.baseUrl + "/events")
    url.searchParams.set("after", String(after))

    installEventSource()
    const es = new EventSource(url)
    const handler = (ev: MessageEvent) => {
      try {
        const frame = JSON.parse(ev.data) as StreamFrame
        if (!("kind" in frame)) handlers.onEvent(frame)
        else if (frame.kind === "transcript") handlers.onTranscript?.(frame)
        else if (frame.kind === "activity") handlers.onActivity?.(frame)
      } catch (err) {
        console.error("[kandy] bad event payload", err)
      }
    }
    // Named SSE events don't fire onmessage, so bind each type explicitly.
    for (const type of [...EVENT_TYPES, "transcript", "activity"]) {
      es.addEventListener(type, handler as EventListener)
    }
    if (handlers.onError) es.onerror = handlers.onError

    return () => es.close()
  }
}

const EVENT_TYPES = [
  "board.created",
  "column.created",
  "note.created",
  "note.edited",
  "note.moved",
  "note.assigned",
  "note.status",
  "note.deleted",
  "run.requested",
  "run.started",
  "run.output",
  "run.tool",
  "run.session",
  "run.metrics",
  "note.policy",
  "note.model",
  "board.models",
  "board.removed",
  "note.pr",
  "board.setup",
  "run.blocked",
  "run.unblocked",
  "run.finished",
  "review.opened",
  "review.decided",
] as const
