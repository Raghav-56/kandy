/**
 * The terminal board. State and effects live here; what each screen shows is
 * decided by the pure modules beside it (board, transcript, diff, keys,
 * editor) and drawn by the thin pieces in ui.tsx.
 */
import type { KandyClient } from "@kandy/client"
import {
  AGENT_NAMES,
  promptsFor,
  splitPrompt,
  type AgentId,
  type AgentInfo,
  type Board,
  type BoardView,
  type Note,
  type PermissionPrompt,
  type RunnerInfo,
} from "@kandy/core"
import { Box, Text, useApp, useInput, useWindowSize } from "ink"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import {
  agentLabel,
  boardRows,
  defaultAgent,
  diffstat,
  giveTargets,
  glyph,
  heldForMe,
  inboxColumn,
  isLive,
  machineName,
  moveSelection,
  needsYou,
  noteClock,
  readyAgents,
  reconcileSelection,
  rowIndex,
  runOf,
  runningCount,
  runsOf,
  scrollOffset,
  selectFirst,
  selectLast,
  type Row,
} from "./board.js"
import { clampOffset, jumpFile, parseDiff, type ParsedDiff } from "./diff.js"
import { editKey, emptyEditor, type Editor } from "./editor.js"
import { helpSections, hints, keyAction, stageOf, type Action, type KeyCtx } from "./keys.js"
import type { LiveBoard } from "./live.js"
import { palette, toneProps, type Palette, type Tone } from "./theme.js"
import { fit, textWidth, tildify, truncate, truncateStart, wrap } from "./text.js"
import { FOLLOWING, scroll, toBottom, toTop, transcriptRows, viewStart, type Follow, type Seg } from "./transcript.js"
import { Fill, Hints, Rule, Segs, Split } from "./ui.js"

export type AppProps = {
  client: KandyClient
  live: LiveBoard
  boards: Board[]
  boardId: string | null
  hub: boolean | undefined
  /** Somewhere for stray console output to go instead of the screen. */
  onLog: (sink: ((text: string) => void) | null) => void
}

type Screen = { kind: "board" } | { kind: "note"; noteId: string } | { kind: "diff"; noteId: string } | { kind: "help" }

type InputPurpose = "new" | "new-hold" | "message" | "revise" | "deny" | "filter"
type Overlay =
  | { kind: "input"; purpose: InputPurpose; editor: Editor; noteId: string | null; prompt: PermissionPrompt | null }
  | { kind: "confirm"; purpose: "merge" | "discard"; noteId: string }
  | { kind: "pick"; purpose: "agent" | "board" | "runner"; title: string; items: PickItem[]; index: number; noteId: string | null }

type PickItem = { id: string; label: string; hint: string }

type Toast = { text: string; tone: Tone }

type DiffState = {
  noteId: string
  status: "loading" | "ready" | "error"
  parsed: ParsedDiff
  stat: string
  branch: string | null
  base: string | null
  offset: number
}

const INPUT_LABEL: Record<InputPurpose, string> = {
  new: "New note — runs on enter",
  "new-hold": "New note — saved to Inbox, not run",
  message: "Message the agent",
  revise: "Send back with a comment",
  deny: "Deny — say why (optional)",
  filter: "Filter",
}

const MULTILINE: Record<InputPurpose, boolean> = {
  new: true,
  "new-hold": true,
  message: true,
  revise: true,
  deny: false,
  filter: false,
}

const MAX_INPUT_ROWS = 5
const LIVE_RUN = new Set(["starting", "running", "blocked"])

function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/\s+/g, " ").trim() || "Something went wrong"
}

/** "Claude Code wants to run: npm test" */
export function promptLine(prompt: PermissionPrompt, agent: string | null): string {
  const who = agent ? (AGENT_NAMES[agent] ?? agent) : "The agent"
  const verb = /^(bash|shell|exec|command|run_shell_command)$/i.test(prompt.tool) ? "run" : `use ${prompt.tool}`
  return `${who} wants to ${verb}: ${prompt.command.replace(/\s+/g, " ").trim()}`
}

export function App({ client, live, boards: initialBoards, boardId: initialBoardId, hub: hubOpt, onLog }: AppProps) {
  const { exit } = useApp()
  const { columns, rows: termRows } = useWindowSize()
  const width = Math.max(20, columns)
  const height = Math.max(8, termRows)
  const p: Palette = useMemo(() => palette(), [])

  const state = useSyncExternalStore(live.subscribe, live.getSnapshot)
  const view = state.view

  const [boards, setBoards] = useState(initialBoards)
  const [boardId, setBoardId] = useState(initialBoardId)
  const [stack, setStack] = useState<Screen[]>([{ kind: "board" }])
  const screen = stack[stack.length - 1]!
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [follow, setFollow] = useState<Follow>(FOLLOWING)
  const [diff, setDiff] = useState<DiffState | null>(null)
  const [helpOffset, setHelpOffset] = useState(0)
  const [tick, setTick] = useState(0)
  const [me, setMe] = useState<{ hub: boolean; email: string | null } | null>(null)
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  const [runners, setRunners] = useState<RunnerInfo[]>([])
  const hub = hubOpt ?? me?.hub ?? false

  // --- effects ---------------------------------------------------------------

  const flash = useCallback((text: string, tone: Tone = "plain") => setToast({ text, tone }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.tone === "berry" ? 5000 : 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    onLog((text) => flash(text.split("\n")[0] ?? text, "dim"))
    return () => onLog(null)
  }, [onLog, flash])

  useEffect(() => {
    if (boardId) void live.open(boardId)
  }, [boardId, live])

  // No board yet: someone may be creating one in the web app. Wait for it.
  useEffect(() => {
    if (boardId) return
    const t = setInterval(() => {
      client
        .boards()
        .then(({ boards }) => {
          setBoards(boards)
          if (boards[0]) setBoardId(boards[0].id)
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [boardId, client])

  useEffect(() => {
    client.me().then((m) => setMe({ hub: m.hub, email: m.email }), () => {})
    client.agents().then((a) => setAgents(a.agents), () => {})
  }, [client])

  useEffect(() => {
    if (!hub) return
    const load = () => void client.runners().then((r) => setRunners(r.runners), () => {})
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [client, hub])

  // Motion only while something is live; otherwise just keep clocks honest.
  const anyRunning = !!view?.notes.some((n) => n.status === "running")
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), anyRunning ? 100 : 5000)
    return () => clearInterval(t)
  }, [anyRunning])

  // --- derived ---------------------------------------------------------------

  const rows = useMemo<Row[]>(() => (view ? boardRows(view, filter) : []), [view, filter])
  const lastIndex = useRef(0)
  const boardOffset = useRef(0)
  const effectiveSelected = reconcileSelection(rows, selected, lastIndex.current)
  const selIndex = rowIndex(rows, effectiveSelected)
  if (selIndex >= 0) lastIndex.current = selIndex

  const focusId = screen.kind === "note" || screen.kind === "diff" ? screen.noteId : screen.kind === "board" ? effectiveSelected : null
  const focus: Note | null = (view && focusId && view.notes.find((n) => n.id === focusId)) || null
  const focusPrompts = view && focus ? promptsFor(view, focus.id) : []
  const heldMine = !!focus && hub && heldForMe(focus, runners, me?.email ?? null)

  const ctx: KeyCtx = {
    screen: screen.kind,
    hub,
    filtering: filter !== "",
    prompt: focusPrompts.length > 0,
    heldMine,
    note: !!focus,
    stage: focus && !focus.held ? stageOf(focus.status) : null,
  }

  // --- layout ----------------------------------------------------------------

  const inputRows =
    overlay?.kind === "input"
      ? Math.min(MAX_INPUT_ROWS, wrapEditor(overlay.editor, width - 4).length) + 1
      : 0
  const pinned = screen.kind === "note" && focus ? pinnedRows(focusPrompts, focus, view, heldMine, runners, width, p) : []
  const footerRows = 2 + inputRows + pinned.length
  const bodyHeight = Math.max(1, height - 2 - footerRows)

  // --- actions ---------------------------------------------------------------

  const act = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string | null)): Promise<T | undefined> => {
      try {
        const r = await fn()
        const msg = typeof ok === "function" ? ok(r) : ok
        if (msg) flash(msg, "mint")
        return r
      } catch (err) {
        flash(errText(err), "berry")
        return undefined
      }
    },
    [flash],
  )

  const ready = readyAgents(agents)

  const runWith = useCallback(
    (noteId: string, agent: AgentId) =>
      act(
        () => client.runNote(noteId, agent),
        (r) => (r.held ? "Held — waiting for the machine's owner to say yes" : `Running with ${agentLabel(agent)}`),
      ),
    [act, client],
  )

  const pickAgent = (noteId: string) => {
    if (ready.length === 0) return flash("No agent is ready — install one and sign in first", "lemon")
    setOverlay({
      kind: "pick",
      purpose: "agent",
      title: "Run with",
      noteId,
      index: 0,
      items: ready.map((a) => {
        const info = agents?.find((i) => i.id === a)
        return { id: a, label: agentLabel(a), hint: info?.version ?? "" }
      }),
    })
  }

  const run = (note: Note) => {
    if (note.held) return flash("Already asked — waiting for the machine's owner", "lemon")
    if (isLive(note)) return flash("Already running", "dim")
    if (note.agent) void runWith(note.id, note.agent)
    else pickAgent(note.id)
  }

  const createNote = async (text: string, andRun: boolean) => {
    if (!view) return
    const { title, body } = splitPrompt(text)
    if (!title) return flash("A note needs a title", "lemon")
    const column = inboxColumn(view)
    if (!column) return flash("This board has no columns", "berry")
    const created = await act(() => client.createNote(view.board.id, column, title, body))
    if (!created) return
    setSelected(created.noteId)
    if (created.rejected.length) flash(created.rejected.map((r) => r.reason).join("; "), "lemon")
    if (!andRun) return flash("Saved to Inbox", "mint")
    const agent = defaultAgent(view, ready)
    if (agent) await runWith(created.noteId, agent)
    else pickAgent(created.noteId)
  }

  const openDiff = (noteId: string) => {
    setDiff({ noteId, status: "loading", parsed: { rows: [], files: [] }, stat: "", branch: null, base: null, offset: 0 })
    push({ kind: "diff", noteId })
    client.diff(noteId).then(
      (d) =>
        setDiff((cur) =>
          cur && cur.noteId === noteId
            ? { ...cur, status: "ready", parsed: parseDiff(d.diff), stat: d.stat.trim(), branch: d.branch, base: d.baseBranch }
            : cur,
        ),
      (err: unknown) => {
        setDiff((cur) => (cur && cur.noteId === noteId ? { ...cur, status: "error" } : cur))
        flash(errText(err), "berry")
      },
    )
  }

  const push = (s: Screen) => setStack((st) => [...st, s])
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))

  const openNote = (noteId: string) => {
    setFollow(FOLLOWING)
    push({ kind: "note", noteId })
  }

  const switchBoard = async () => {
    const res = await act(() => client.boards())
    const list = res?.boards ?? boards
    setBoards(list)
    if (list.length === 0) return flash("No boards", "lemon")
    setOverlay({
      kind: "pick",
      purpose: "board",
      title: "Switch board",
      noteId: null,
      index: Math.max(0, list.findIndex((b) => b.id === boardId)),
      items: list.map((b) => ({ id: b.id, label: b.name, hint: b.repoPath })),
    })
  }

  const answer = (prompt: PermissionPrompt, decision: "allow" | "deny", scope: "once" | "note", comment?: string) =>
    act(
      () => client.respond(prompt.runId, prompt.requestId, decision, { scope, ...(comment ? { comment } : {}) }),
      decision === "deny" ? "Denied" : scope === "note" ? "Allowed for this note" : "Allowed once",
    )

  // --- the transcript (note screen) ------------------------------------------

  const noteRuns = useMemo(() => (view && focus && screen.kind === "note" ? runsOf(view, focus.id) : []), [view, focus, screen.kind])
  useEffect(() => {
    for (const r of noteRuns) void live.loadTranscript(r.id)
  }, [noteRuns, live])
  const tRows = useMemo(
    () =>
      transcriptRows(
        noteRuns.map((run) => ({ run, frames: state.transcripts[run.id] ?? [] })),
        width - 2,
      ),
    // Clocks in run separators move with `tick`; recomputing is cheap thanks to the per-frame cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteRuns, state.transcripts, width, tick],
  )

  // --- keys ------------------------------------------------------------------

  const metrics = useRef({ transcriptHeight: 1, diffHeight: 1, helpRows: 0 })

  useInput((input, key) => {
    if (key.ctrl && input === "c") return exit()

    if (overlay?.kind === "input") {
      const res = editKey(overlay.editor, input, key, { multiline: MULTILINE[overlay.purpose] })
      if (overlay.purpose === "filter") {
        if (res.done === "cancel") {
          setFilter("")
          return setOverlay(null)
        }
        setFilter(res.editor.text)
        if (res.done === "submit") return setOverlay(null)
        return setOverlay({ ...overlay, editor: res.editor })
      }
      if (res.done === "cancel") return setOverlay(null)
      if (res.done !== "submit") return setOverlay({ ...overlay, editor: res.editor })
      const text = res.editor.text.trim()
      setOverlay(null)
      const noteId = overlay.noteId
      switch (overlay.purpose) {
        case "new":
        case "new-hold":
          if (text) void createNote(text, overlay.purpose === "new")
          return
        case "message":
          if (text && noteId)
            void act(
              () => client.message(noteId, text),
              (r) => (r.delivery === "live" ? "Sent to the agent" : "Queued as a follow-up"),
            )
          return
        case "revise":
          if (noteId) void act(() => client.reviewNote(noteId, "revise", text || undefined), "Sent back to the agent")
          return
        case "deny":
          if (overlay.prompt) void answer(overlay.prompt, "deny", "once", text || undefined)
          return
      }
      return
    }

    if (overlay?.kind === "confirm") {
      if (input === "y" || key.return) {
        const { noteId, purpose } = overlay
        setOverlay(null)
        void act(
          () => client.reviewNote(noteId, purpose),
          purpose === "merge" ? "Merged" : "Discarded",
        ).then((r) => {
          if (r && (screen.kind === "note" || screen.kind === "diff")) setStack([{ kind: "board" }])
        })
      } else if (input === "n" || key.escape || input === "q") setOverlay(null)
      return
    }

    if (overlay?.kind === "pick") {
      const n = overlay.items.length
      if (key.escape || input === "q") return setOverlay(null)
      if (key.upArrow || input === "k") return setOverlay({ ...overlay, index: (overlay.index - 1 + n) % n })
      if (key.downArrow || input === "j") return setOverlay({ ...overlay, index: (overlay.index + 1) % n })
      const digit = /^[1-9]$/.test(input) ? Number(input) - 1 : -1
      if (!key.return && (digit < 0 || digit >= n)) return
      const item = overlay.items[digit >= 0 ? digit : overlay.index]
      setOverlay(null)
      if (!item) return
      if (overlay.purpose === "agent" && overlay.noteId) void runWith(overlay.noteId, item.id as AgentId)
      if (overlay.purpose === "runner" && overlay.noteId) {
        const noteId = overlay.noteId
        void act(() => client.assign(noteId, { runner: item.id }), `Given to ${item.label}`)
      }
      if (overlay.purpose === "board" && item.id !== boardId) {
        setStack([{ kind: "board" }])
        setSelected(null)
        setFilter("")
        setBoardId(item.id)
      }
      return
    }

    const action = keyAction(ctx, input, key)
    if (action) handle(action)
  })

  const handle = (a: Action) => {
    const note = focus
    switch (a.type) {
      case "quit":
        return exit()
      case "back":
        if (screen.kind === "help") setHelpOffset(0)
        return back()
      case "help":
        if (screen.kind === "help") return back()
        setHelpOffset(0)
        return push({ kind: "help" })
      case "boards":
        return void switchBoard()
      case "filter":
        return setOverlay({ kind: "input", purpose: "filter", editor: emptyEditor(filter), noteId: null, prompt: null })
      case "clearFilter":
        return setFilter("")
      case "new":
        return setOverlay({ kind: "input", purpose: a.run ? "new" : "new-hold", editor: emptyEditor(), noteId: null, prompt: null })
      case "move":
      case "page":
      case "top":
      case "bottom":
        return scrollAction(a)
      case "file":
        if (!diff) return
        return setDiff({
          ...diff,
          offset: clampOffset(jumpFile(diff.parsed.files, diff.offset, a.dir), diff.parsed.rows.length, metrics.current.diffHeight),
        })
    }
    if (!note) return
    switch (a.type) {
      case "open":
        return openNote(note.id)
      case "run":
        return run(note)
      case "cancel": {
        const r = view ? runOf(view, note) : undefined
        if (!r || !LIVE_RUN.has(r.status)) return flash("Nothing running", "dim")
        return void act(() => client.cancelRun(r.id), "Cancelled")
      }
      case "diff":
        return openDiff(note.id)
      case "message":
        return setOverlay({ kind: "input", purpose: "message", editor: emptyEditor(), noteId: note.id, prompt: null })
      case "revise":
        return setOverlay({ kind: "input", purpose: "revise", editor: emptyEditor(), noteId: note.id, prompt: null })
      case "merge":
      case "discard":
        return setOverlay({ kind: "confirm", purpose: a.type, noteId: note.id })
      case "give": {
        if (!hub || !view) return
        const targets = giveTargets(runners, view.board.id, note)
        if (targets.length === 0) return flash("No other machine online has this board", "lemon")
        return setOverlay({
          kind: "pick",
          purpose: "runner",
          title: "Give to",
          noteId: note.id,
          index: 0,
          items: targets.map((r) => ({ id: r.runnerId, label: r.name, hint: r.owner ?? "" })),
        })
      }
      case "allow": {
        const prompt = focusPrompts[0]
        if (!prompt) return
        if (a.scope === "note" && !prompt.rule) return flash("This one can't be allowed for the whole note — a allows it once", "lemon")
        return void answer(prompt, "allow", a.scope)
      }
      case "deny": {
        const prompt = focusPrompts[0]
        if (!prompt) return
        return setOverlay({ kind: "input", purpose: "deny", editor: emptyEditor(), noteId: note.id, prompt })
      }
      case "consent":
        return void act(
          () => client.consent(note.id, a.accept, a.always),
          a.accept ? (a.always ? "Allowed — and always from now on" : "Running it") : "Declined",
        )
    }
  }

  const scrollAction = (a: Extract<Action, { type: "move" | "page" | "top" | "bottom" }>) => {
    if (screen.kind === "board") {
      if (a.type === "top") return setSelected(selectFirst(rows))
      if (a.type === "bottom") return setSelected(selectLast(rows))
      const by = a.type === "move" ? a.by : a.by * Math.max(1, bodyHeight - 2)
      return setSelected(moveSelection(rows, effectiveSelected, by))
    }
    if (screen.kind === "note") {
      const h = metrics.current.transcriptHeight
      if (a.type === "top") return setFollow(toTop())
      if (a.type === "bottom") return setFollow(toBottom())
      const by = a.type === "move" ? a.by : a.by * Math.max(1, h - 1)
      return setFollow((f) => scroll(f, by, tRows.length, h))
    }
    if (screen.kind === "diff" && diff) {
      const h = metrics.current.diffHeight
      const total = diff.parsed.rows.length
      const offset =
        a.type === "top" ? 0 : a.type === "bottom" ? total : diff.offset + (a.type === "move" ? a.by : a.by * Math.max(1, h - 1))
      return setDiff({ ...diff, offset: clampOffset(offset, total, h) })
    }
    if (screen.kind === "help") {
      const max = Math.max(0, metrics.current.helpRows - bodyHeight)
      const by = a.type === "move" ? a.by : a.type === "page" ? a.by * bodyHeight : a.type === "top" ? -1e9 : 1e9
      return setHelpOffset((o) => Math.max(0, Math.min(max, o + by)))
    }
  }

  // --- render ----------------------------------------------------------------

  const now = Date.now()
  let body: ReactNode[]
  if (overlay?.kind === "pick") body = pickRows(overlay, width, bodyHeight, p)
  else if (!boardId) body = messageRows(["No boards yet.", "Create one in the web app — this screen will pick it up."], width, p)
  else if (!view) body = messageRows([state.error ? `Couldn't load the board: ${state.error}` : "Loading board…"], width, p, state.error ? "berry" : "dim")
  else if (screen.kind === "board") body = boardBody()
  else if (screen.kind === "help") body = helpBody()
  else if (!focus) body = messageRows(["That note is gone."], width, p, "dim")
  else if (screen.kind === "note") body = noteBody(view, focus)
  else body = diffBody(focus)

  function boardBody(): ReactNode[] {
    if (!view) return []
    if (rows.length === 0 || !rows.some((r) => r.kind === "note")) {
      const lanes = rows.map((r) => (r.kind === "lane" ? laneRow(r.name, r.count, width, r.key) : null))
      return [
        ...lanes,
        <Text key="empty-gap"> </Text>,
        <Text key="empty" dimColor>
          {filter ? `  Nothing matches “${filter}”. esc clears the filter.` : "  No notes yet — press n to write one."}
        </Text>,
      ]
    }
    const offset = scrollOffset(boardOffset.current, selIndex, bodyHeight, rows.length)
    boardOffset.current = offset
    return rows.slice(offset, offset + bodyHeight).map((r) =>
      r.kind === "lane"
        ? laneRow(r.name, r.count, width, r.key)
        : noteRow(view, r.note, r.key === effectiveSelected, runners, hub, width, now, tick, p),
    )
  }

  function noteBody(v: BoardView, note: Note): ReactNode[] {
    const head = noteHeader(v, note, state.activity, runners, hub, width, p)
    const h = Math.max(1, bodyHeight - head.length)
    metrics.current.transcriptHeight = h
    let content: ReactNode[]
    if (tRows.length === 0) {
      const lines = [
        ...(note.body ? wrap(note.body, width - 2).map((t) => ({ t, tone: "plain" as Tone })) : []),
        ...(note.body ? [{ t: "", tone: "plain" as Tone }] : []),
        {
          t: noteRuns.length === 0 ? "Not run yet — r runs it." : isLive(note) ? "Waiting for the agent to say something…" : "No transcript.",
          tone: "dim" as Tone,
        },
      ]
      content = lines.map((l, i) => (
        <Text key={`b${i}`} {...toneProps(p, l.tone)} wrap="truncate-end">
          {" " + l.t}
        </Text>
      ))
    } else {
      const start = viewStart(follow, tRows.length, h)
      content = tRows.slice(start, start + h).map((r, i) => <Segs key={`t${start + i}`} segs={[{ text: " ", tone: "plain" }, ...r]} p={p} />)
      if (!follow.follow && start + h < tRows.length) {
        const more = tRows.length - start - h
        content[content.length - 1] = (
          <Text key="more" {...toneProps(p, "lemon")}>
            {fit(` ↓ ${more} more — G to follow`, width)}
          </Text>
        )
      }
    }
    return [...head, ...content]
  }

  function diffBody(note: Note): ReactNode[] {
    const head: ReactNode[] = [
      <Text key="dt" bold wrap="truncate-end">
        {" " + truncate(note.title, width - 2)}
      </Text>,
      <Segs
        key="ds"
        p={p}
        segs={[
          { text: " ", tone: "plain" },
          ...(note.stat
            ? [
                { text: `${note.stat.files} file${note.stat.files === 1 ? "" : "s"}  `, tone: "dim" as Tone },
                { text: `+${note.stat.insertions} `, tone: "mint" as Tone },
                { text: `−${note.stat.deletions}`, tone: "berry" as Tone },
              ]
            : []),
          ...(diff?.branch ? [{ text: `  ${diff.branch}${diff.base ? ` → ${diff.base}` : ""}`, tone: "dim" as Tone }] : []),
        ]}
      />,
      <Rule key="dr" width={width} p={p} />,
    ]
    const h = Math.max(1, bodyHeight - head.length)
    metrics.current.diffHeight = h
    if (!diff || diff.noteId !== note.id || diff.status === "loading") return [...head, <Text key="dl" dimColor> Loading diff…</Text>]
    if (diff.status === "error") return [...head, <Text key="de" {...toneProps(p, "berry")}> Couldn't load the diff.</Text>]
    if (diff.parsed.rows.length === 0) return [...head, <Text key="d0" dimColor> No changes.</Text>]
    const start = clampOffset(diff.offset, diff.parsed.rows.length, h)
    return [
      ...head,
      ...diff.parsed.rows.slice(start, start + h).map((r, i) => (
        <Text key={`d${start + i}`} {...toneProps(p, r.tone)} bold={r.bold} wrap="truncate-end">
          {" " + truncate(r.text, width - 1)}
        </Text>
      )),
    ]
  }

  function helpBody(): ReactNode[] {
    const out: ReactNode[] = []
    for (const s of helpSections()) {
      out.push(<Text key={`h-${s.title}`} bold>{" " + s.title}</Text>)
      for (const k of s.keys)
        out.push(
          <Text key={`h-${s.title}-${k.key}-${k.label}`} wrap="truncate-end">
            <Text bold>{"   " + fit(k.key, 10)}</Text>
            <Text dimColor>{k.label}</Text>
          </Text>,
        )
      out.push(<Text key={`h-${s.title}-gap`}> </Text>)
    }
    metrics.current.helpRows = out.length
    return out.slice(helpOffset, helpOffset + bodyHeight)
  }

  const header = view ? (
    <Split
      width={width}
      p={p}
      left={[
        { text: " kandy ", tone: "mint", bold: true },
        { text: view.board.name, tone: "plain", bold: true },
        { text: "  " + truncateStart(tildify(view.board.repoPath), Math.max(12, Math.floor(width / 3))), tone: "dim" },
        ...(filter ? [{ text: `  /${filter}`, tone: "lemon" as Tone }] : []),
      ]}
      right={statusSegs(view, state.connected)}
    />
  ) : (
    <Text bold {...toneProps(p, "mint")}>
      {" kandy"}
    </Text>
  )

  return (
    <Box flexDirection="column" width={width} height={height}>
      {header}
      <Rule width={width} p={p} />
      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        <Fill rows={body} height={bodyHeight} />
      </Box>
      {pinned}
      {overlay?.kind === "input" ? inputBox(overlay, width, p) : null}
      {statusLine(overlay, toast, view, width, p)}
      <Hints hints={overlay ? overlayHints(overlay) : hints(ctx)} width={width} p={p} />
    </Box>
  )
}

// --- pieces ------------------------------------------------------------------

function statusSegs(view: BoardView, connected: boolean): Seg[] {
  const running = runningCount(view)
  const need = needsYou(view)
  const segs: Seg[] = []
  if (running > 0) segs.push({ text: `${running} running`, tone: "mint" }, { text: " · ", tone: "dim" })
  segs.push({ text: `${need} need you`, tone: need > 0 ? "lemon" : "dim", bold: need > 0 })
  segs.push({ text: " · ", tone: "dim" })
  segs.push(connected ? { text: "● live ", tone: "mint" } : { text: "○ reconnecting ", tone: "lemon" })
  return segs
}

function laneRow(name: string, count: number, width: number, key: string): ReactNode {
  const head = ` ${name.toUpperCase()} ${count} `
  return (
    <Text key={key} wrap="truncate-end">
      <Text bold>{` ${name.toUpperCase()}`}</Text>
      <Text dimColor>{` ${count} ` + "─".repeat(Math.max(0, width - textWidth(head) - 1))}</Text>
    </Text>
  )
}

function noteRow(
  view: BoardView,
  note: Note,
  selected: boolean,
  runners: readonly RunnerInfo[],
  hub: boolean,
  width: number,
  now: number,
  tick: number,
  p: Palette,
): ReactNode {
  const g = glyph(view, note, tick)
  const right: Seg[] = []
  const stat = diffstat(note)
  if (stat && note.stat) {
    right.push({ text: `+${note.stat.insertions}`, tone: "mint" }, { text: ` −${note.stat.deletions}  `, tone: "berry" })
  }
  if (note.agent) right.push({ text: note.agent + "  ", tone: "dim" })
  if (hub && (note.runner || note.held)) {
    const m = machineName(runners, note.held?.runnerId ?? note.runner)
    if (m) right.push({ text: `on ${truncate(m, 14)}  `, tone: note.held ? "lemon" : "dim" })
  }
  right.push({ text: noteClock(view, note, now).padStart(3) + " ", tone: "dim" })
  const titleTone: Tone = note.status === "done" ? "dim" : "plain"
  return (
    <Split
      key={note.id}
      width={width}
      p={p}
      left={[
        { text: selected ? " ›" : "  ", tone: "mint", bold: true },
        { text: ` ${g.char} `, tone: g.tone, bold: g.tone === "lemon" },
        { text: note.title.replace(/\s+/g, " "), tone: titleTone, bold: selected, inverse: false },
      ]}
      right={right}
    />
  )
}

function noteHeader(
  view: BoardView,
  note: Note,
  activity: Readonly<Record<string, { tool: string; detail: string }>>,
  runners: readonly RunnerInfo[],
  hub: boolean,
  width: number,
  p: Palette,
): ReactNode[] {
  const g = glyph(view, note)
  const run = runOf(view, note)
  const model = note.model ?? run?.model ?? (note.agent ? view.board.models[note.agent] : undefined) ?? null
  const meta: Seg[] = [
    { text: " " + g.char + " ", tone: g.tone, bold: true },
    { text: note.held ? "held" : note.status, tone: g.tone === "plain" ? "plain" : g.tone },
  ]
  const dot = (): Seg => ({ text: " · ", tone: "dim" })
  if (note.agent) meta.push(dot(), { text: agentLabel(note.agent), tone: "plain" })
  if (model) meta.push(dot(), { text: model, tone: "dim" })
  if (note.branch) meta.push(dot(), { text: note.branch, tone: "dim" })
  if (note.stat && (note.stat.insertions || note.stat.deletions))
    meta.push(dot(), { text: `+${note.stat.insertions}`, tone: "mint" }, { text: ` −${note.stat.deletions}`, tone: "berry" })
  meta.push(dot(), { text: note.policy === "full" ? "full access" : "repo only", tone: note.policy === "full" ? "lemon" : "dim" })
  if (hub && note.runner) meta.push(dot(), { text: `on ${machineName(runners, note.runner)}`, tone: "dim" })
  if (run?.costUsd != null) meta.push(dot(), { text: `$${run.costUsd.toFixed(2)}`, tone: "dim" })

  const rows: ReactNode[] = [
    <Text key="nt" bold wrap="truncate-end">
      {" " + truncate(note.title.replace(/\s+/g, " "), width - 2)}
    </Text>,
    <Segs key="nm" segs={meta} p={p} />,
  ]
  const now = run && LIVE_RUN.has(run.status) ? activity[run.id] : undefined
  if (now) {
    rows.push(
      <Segs
        key="na"
        p={p}
        segs={[
          { text: "   ", tone: "plain" },
          { text: now.tool + " ", tone: "dim", bold: true },
          { text: now.detail.replace(/\s+/g, " "), tone: "dim" },
        ]}
      />,
    )
  }
  rows.push(<Rule key="nr" width={width} p={p} />)
  return rows
}

/** Questions and held-run answers, pinned above the footer on the note screen. */
function pinnedRows(
  prompts: readonly PermissionPrompt[],
  note: Note,
  view: BoardView | null,
  heldMine: boolean,
  runners: readonly RunnerInfo[],
  width: number,
  p: Palette,
): ReactNode[] {
  const out: ReactNode[] = []
  if (prompts.length > 0 && view) {
    const agent = view.runs.find((r) => r.id === prompts[0]!.runId)?.agent ?? note.agent
    out.push(<Rule key="pr" width={width} p={p} tone="lemon" />)
    for (const [i, prompt] of prompts.slice(0, 2).entries()) {
      out.push(
        <Text key={`pq${i}`} {...toneProps(p, "lemon")} bold wrap="truncate-end">
          {" ? " + truncate(promptLine(prompt, agent), width - 4)}
        </Text>,
      )
    }
    if (prompts.length > 2) out.push(<Text key="pm" dimColor>{`   +${prompts.length - 2} more waiting`}</Text>)
    const first = prompts[0]!
    out.push(
      <Segs
        key="pk"
        p={p}
        segs={[
          { text: "   a", tone: "plain", bold: true },
          { text: " allow once  ", tone: "dim" },
          ...(first.rule
            ? [
                { text: "A", tone: "plain" as Tone, bold: true },
                { text: " allow for this note  ", tone: "dim" as Tone },
              ]
            : []),
          { text: "D", tone: "plain", bold: true },
          { text: " deny", tone: "dim" },
        ]}
      />,
    )
  }
  if (note.held) {
    const runner = runners.find((r) => r.runnerId === note.held!.runnerId)
    const who = note.held.requestedBy ?? "Someone"
    out.push(<Rule key="hr" width={width} p={p} tone="lemon" />)
    out.push(
      <Text key="hq" {...toneProps(p, "lemon")} wrap="truncate-end">
        {heldMine
          ? ` ! ${who} wants to run this on your machine with ${agentLabel(note.held.agent)}.`
          : ` ! Waiting for ${runner?.owner ?? "the machine's owner"} to allow it on ${runner?.name ?? "their machine"}.`}
      </Text>,
    )
    if (heldMine)
      out.push(
        <Segs
          key="hk"
          p={p}
          segs={[
            { text: "   y", tone: "plain", bold: true },
            { text: " run it  ", tone: "dim" },
            { text: "Y", tone: "plain", bold: true },
            { text: ` always allow ${who}  `, tone: "dim" },
            { text: "n", tone: "plain", bold: true },
            { text: " decline", tone: "dim" },
          ]}
        />,
      )
  }
  return out
}

function wrapEditor(ed: Editor, width: number): string[] {
  const text = ed.text.slice(0, ed.cursor) + "█" + ed.text.slice(ed.cursor)
  return wrap(text, Math.max(4, width))
}

function inputBox(o: Extract<Overlay, { kind: "input" }>, width: number, p: Palette): ReactNode {
  // The cursor is drawn as an inverse cell: wrap with a placeholder glyph,
  // then split each row on it.
  const lines = wrapEditor(o.editor, width - 4)
  const cursorLine = lines.findIndex((l) => l.includes("█"))
  const start = Math.max(0, Math.min(cursorLine - MAX_INPUT_ROWS + 1, lines.length - MAX_INPUT_ROWS))
  const shown = lines.slice(start, start + MAX_INPUT_ROWS)
  return (
    <Box flexDirection="column">
      <Text {...toneProps(p, "mint")} bold wrap="truncate-end">
        {" " + INPUT_LABEL[o.purpose]}
      </Text>
      {shown.map((l, i) => {
        const at = l.indexOf("█")
        const prefix = i === 0 && start === 0 ? " › " : "   "
        if (at === -1)
          return (
            <Text key={i} wrap="truncate-end">
              {prefix + l}
            </Text>
          )
        return (
          <Text key={i} wrap="truncate-end">
            {prefix + l.slice(0, at)}
            <Text inverse> </Text>
            {l.slice(at + 1)}
          </Text>
        )
      })}
    </Box>
  )
}

function overlayHints(o: Overlay) {
  switch (o.kind) {
    case "input":
      return o.purpose === "filter"
        ? [
            { key: "enter", label: "keep" },
            { key: "esc", label: "clear" },
          ]
        : [
            { key: "enter", label: o.purpose === "new" ? "create & run" : o.purpose === "new-hold" ? "create" : "send" },
            ...(MULTILINE[o.purpose] ? [{ key: "ctrl+j", label: "newline" }] : []),
            { key: "esc", label: "cancel" },
          ]
    case "confirm":
      return [
        { key: "y", label: o.purpose },
        { key: "n", label: "cancel" },
      ]
    case "pick":
      return [
        { key: "↑↓", label: "choose" },
        { key: "enter", label: "select" },
        { key: "esc", label: "cancel" },
      ]
  }
}

function statusLine(overlay: Overlay | null, toast: Toast | null, view: BoardView | null, width: number, p: Palette): ReactNode {
  if (overlay?.kind === "confirm") {
    const note = view?.notes.find((n) => n.id === overlay.noteId)
    const verb = overlay.purpose === "merge" ? "Merge" : "Discard"
    const tail = overlay.purpose === "merge" ? " into the base branch?" : "? The branch and worktree are thrown away."
    return (
      <Text {...toneProps(p, overlay.purpose === "merge" ? "mint" : "berry")} bold wrap="truncate-end">
        {" " + truncate(`${verb} “${note?.title ?? "this note"}”${tail}  y / n`, width - 2)}
      </Text>
    )
  }
  if (toast)
    return (
      <Text {...toneProps(p, toast.tone)} wrap="truncate-end">
        {" " + truncate(toast.text, width - 2)}
      </Text>
    )
  return <Text> </Text>
}

function pickRows(o: Extract<Overlay, { kind: "pick" }>, width: number, height: number, p: Palette): ReactNode[] {
  const rows: ReactNode[] = [
    <Text key="pt" bold>
      {" " + o.title}
    </Text>,
    <Text key="pg"> </Text>,
  ]
  const room = Math.max(1, height - rows.length)
  const start = Math.max(0, Math.min(o.index - room + 1, o.items.length - room))
  o.items.slice(start, start + room).forEach((item, j) => {
    const i = start + j
    const sel = i === o.index
    rows.push(
      <Split
        key={`pi${i}`}
        width={width}
        p={p}
        left={[
          { text: sel ? " › " : "   ", tone: "mint", bold: true },
          { text: i < 9 ? `${i + 1} ` : "  ", tone: "dim" },
          { text: item.label, tone: "plain", bold: sel },
          { text: item.hint ? "  " + item.hint : "", tone: "dim" },
        ]}
        right={[]}
      />,
    )
  })
  return rows
}

function messageRows(lines: string[], width: number, p: Palette, tone: Tone = "plain"): ReactNode[] {
  return [
    <Text key="m-gap"> </Text>,
    ...lines.map((l, i) => (
      <Text key={`m${i}`} {...toneProps(p, i === 0 ? tone : "dim")} wrap="truncate-end">
        {"  " + truncate(l, width - 4)}
      </Text>
    )),
  ]
}
