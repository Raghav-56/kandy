import type {
  AgentId,
  AgentInfo,
  Board,
  BoardView,
  KandyEvent,
  OutputLine,
} from "@kandy/core"

export type ClientOptions = {
  baseUrl?: string
  token?: string
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
  private token: string | undefined

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://127.0.0.1:4477").replace(/\/$/, "")
    this.token = opts.token
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
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
  boards() {
    return this.req<{ boards: Board[] }>("GET", "/boards")
  }
  createBoard(name: string, repoPath: string) {
    return this.req<{ board: Board; seq: number }>("POST", "/boards", { name, repoPath })
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
  deleteNote(noteId: string) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/delete`, {})
  }
  runNote(noteId: string, agent?: AgentId) {
    return this.req<{ runId: string; seq: number }>("POST", `/notes/${noteId}/run`, { agent })
  }
  reviewNote(noteId: string, decision: "merge" | "discard" | "revise", comment?: string) {
    return this.req<{ seq: number }>("POST", `/notes/${noteId}/review`, { decision, comment })
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
   */
  events(after: number, onEvent: (e: KandyEvent) => void, onError?: (e: Event) => void): () => void {
    // baseUrl may be relative ("/api" behind a dev proxy), which `new URL`
    // rejects without a base. Resolve against the page origin when there is
    // one; fall back to a bare string for non-browser callers.
    const origin = globalThis.location?.origin
    const url = origin
      ? new URL(this.baseUrl + "/events", origin)
      : new URL(this.baseUrl + "/events")
    url.searchParams.set("after", String(after))
    if (this.token) url.searchParams.set("token", this.token)

    const es = new EventSource(url)
    const handler = (ev: MessageEvent) => {
      try {
        onEvent(JSON.parse(ev.data) as KandyEvent)
      } catch (err) {
        console.error("[kandy] bad event payload", err)
      }
    }
    // Named SSE events don't fire onmessage, so bind each type explicitly.
    for (const type of EVENT_TYPES) es.addEventListener(type, handler as EventListener)
    if (onError) es.onerror = onError

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
  "run.blocked",
  "run.unblocked",
  "run.finished",
  "review.opened",
  "review.decided",
] as const
