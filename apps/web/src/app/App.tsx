import { daemonToken } from "@/lib/daemon-token"
import { cn } from "@/lib/utils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KandyClient } from "@kandy/client"
import { usePanelRef } from "react-resizable-panels"
import type { AgentId, AgentInfo, Board, Forge, RunnerInfo } from "@kandy/core"
import {
  Button,
  Empty,
  LoadingBlock,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarProvider,
} from "@/ui"
import { Backdrop } from "@/brand/Backdrop"
import { Logo } from "@/brand/Logo"
import { Composer } from "@/features/notes/Composer"
import { BoardComposer } from "@/features/notes/BoardComposer"
import { FirstRun } from "@/features/onboarding/FirstRun"
import { NewBoardDialog } from "@/features/boards/NewBoardDialog"
import { readOnlyFor, SOLO, TeamProvider, type Me, type Team } from "@/features/team/team"
import { useBoard } from "@/hooks/useBoard"
import { useTheme } from "@/hooks/useTheme"
import { useRoute } from "@/hooks/useRoute"
import { TooltipProvider } from "@/ui"
import { CommandPalette } from "./CommandPalette"
import { SettingsPage } from "./SettingsPage"
import { TeamPage } from "./TeamPage"
import { UsagePage } from "./UsagePage"
import { NoteDetail } from "./NoteDetail"
import { Sidebar, type View } from "./Sidebar"
import { TriageList } from "./TriageList"

const DETAIL_SIZE_KEY = "kandy.detail-size"

/**
 * Whether the sidebar was left collapsed.
 *
 * The sidebar writes its own cookie but never reads one — shadcn's provider
 * expects a server to read it and hand back `defaultOpen`, which is how it
 * works in Next. There is no server rendering here, so without this the rail
 * sprang back open on every reload and ⌘B only lasted until you refreshed.
 */
function sidebarWasOpen(): boolean {
  try {
    const c = document.cookie.split("; ").find((x) => x.startsWith("sidebar_state="))
    return c ? c.split("=")[1] !== "false" : true
  } catch {
    return true
  }
}

function readDetailSize(): number {
  try {
    const n = Number(localStorage.getItem(DETAIL_SIZE_KEY))
    return Number.isFinite(n) && n >= 22 && n <= 78 ? n : 34
  } catch {
    return 34
  }
}

export function App() {
  const client = useMemo(() => new KandyClient({ baseUrl: "/api", token: daemonToken }), [])
  const [boards, setBoards] = useState<Board[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [forge, setForge] = useState<Forge | null>(null)
  /* Tracked paths for the composer's `@` picker. Fetched once per board —
     it is a few hundred strings and it changes when git does, not live. */
  const [paths, setPaths] = useState<{ files: string[]; dirs: string[] }>({ files: [], dirs: [] })

  const [composing, setComposing] = useState(false)
  /* Carried from the quick bar into the modal, so expanding never costs you
     what you already typed. */
  const [handoff, setHandoff] = useState("")
  const [newBoard, setNewBoard] = useState(false)
  const [palette, setPalette] = useState(false)
  /**
   * A file the daemon would not take.
   *
   * The composer applies the same rule before uploading, so this is the
   * backstop — but a refusal must be said out loud wherever it happens, since a
   * screenshot that never arrives looks exactly like an agent ignoring it.
   */
  const [notice, setNotice] = useState<string | null>(null)
  const { theme, setTheme } = useTheme()

  /*
   * Who this is, asked once. `kandy serve` answers `{ hub: false }` and every
   * team affordance below keys off that — so single-player is not a mode the
   * UI switches into, it is simply what renders when there is no team.
   */
  const [me, setMe] = useState<Me>(SOLO)
  /** The hub's machines, for naming where a note runs. Empty off a hub. */
  const [runners, setRunners] = useState<RunnerInfo[]>([])
  const readOnly = readOnlyFor(me)

  /*
   * Where you are lives in the URL rather than in three useStates, so a
   * refresh — or a link pasted to yourself — lands back on the same note.
   *
   * These keep the setter shapes the rest of the component already uses,
   * including the updater-function forms, so the change is where the state is
   * kept and not how every call site talks to it.
   */
  /*
   * How wide you like the detail pane, kept across sessions.
   *
   * The library's own layout persistence cannot do this here: the pane
   * collapses when you close a note, and it saves that collapsed layout, so
   * reopening later restored 0 and fell back to the minimum. Storing only
   * expanded sizes keeps "wide enough for a diff" meaning what it did before.
   *
   * Sizes are strings because v4 reads a bare number as *pixels* and only a
   * string as a percentage — passing 62 asks for 62px, not 62%.
   */
  const detailPanel = usePanelRef()
  const detailSize = useRef(readDetailSize())
  const rememberDetailSize = useCallback((pct: number) => {
    if (pct < 1) return // A collapse is not a width.
    detailSize.current = pct
    try {
      localStorage.setItem(DETAIL_SIZE_KEY, String(pct))
    } catch {
      // Blocked storage just means it lasts the session.
    }
  }, [])

  const { route, go } = useRoute()
  const { page, boardId, noteId: selected } = route

  type Update<T> = T | ((cur: T) => T)
  const apply = <T,>(v: Update<T>, cur: T): T =>
    typeof v === "function" ? (v as (c: T) => T)(cur) : v

  /*
   * Moving *away* closes the open note; re-affirming where you already are
   * does not. The difference matters on boot: resolving the default board
   * fires setBoardId with the board the URL already named, and clearing the
   * note unconditionally there threw away the deep link on every refresh —
   * which is the entire thing this is for.
   */
  const setPage = useCallback(
    (v: Update<View>) =>
      go((cur) => {
        const page = apply(v, cur.page)
        return { ...cur, page, noteId: page === cur.page ? cur.noteId : null }
      }),
    [go],
  )
  const setSelected = useCallback(
    (v: Update<string | null>) => go((cur) => ({ ...cur, noteId: apply(v, cur.noteId) })),
    [go],
  )
  const setBoardId = useCallback(
    (v: Update<string | null>, replace = false) =>
      go((cur) => {
        const boardId = apply(v, cur.boardId)
        return { ...cur, boardId, noteId: boardId === cur.boardId ? cur.noteId : null }
      }, { replace }),
    [go],
  )

  const { view, connected, error, act, transcript, activity, recent, loadTranscript, clearError } =
    useBoard(boardId, { hub: me.hub })

  useEffect(() => {
    void client.boards().then((r) => {
      setBoards(r.boards)
      setBoardId((id) => id ?? r.boards[0]?.id ?? null, true)
    })
    void client.agents().then((r) => setAgents(r.agents))
    // An older daemon has no /me; that is a single-player daemon by definition.
    void client.me().then(setMe).catch(() => setMe(SOLO))
  }, [client])

  /*
   * Runner names, fetched when a note mentions a machine we cannot name.
   *
   * Keyed on the set of unknown ids rather than on the view, so the stream
   * ticking does not turn into a request per event — and a placement on a
   * machine that joined after the page loaded still gets its name. The Team
   * page polls on its own while it is open.
   */
  const unknownRunners = useMemo(() => {
    if (!me.hub || !view) return ""
    const known = new Set(runners.map((r) => r.runnerId))
    const ids = new Set<string>()
    for (const n of view.notes) {
      if (n.runner && !known.has(n.runner)) ids.add(n.runner)
      if (n.held && !known.has(n.held.runnerId)) ids.add(n.held.runnerId)
    }
    return [...ids].sort().join(",")
  }, [me.hub, view, runners])
  useEffect(() => {
    if (!me.hub) return
    void client.runners().then((r) => setRunners(r.runners)).catch(() => {})
  }, [client, me.hub, unknownRunners])

  const team = useMemo<Team>(
    () => ({
      me,
      runners,
      readOnly,
      consent: async (noteId, accept, always) => {
        // The answer lands on the stream as note.released / run.*, like every
        // other change — nothing to merge from the response.
        await act((c) => c.consent(noteId, accept, always))
      },
    }),
    [me, runners, readOnly, act],
  )

  /*
   * Start a note.
   *
   * On a hub the answer may be 202 `{ held: true, runId: null }`: the note was
   * sent to someone else's machine and is waiting on its owner. Nothing here
   * reads the runId — the run, if there is one, arrives on the stream — so a
   * held answer needs no handling beyond not pretending otherwise. The note's
   * own `held` field is what the card shows.
   */
  const runNote = useCallback(
    (noteId: string, agent?: AgentId) =>
      act(async (c) => {
        const res: { runId: string | null; seq: number; held?: boolean } = await c.runNote(noteId, agent)
        return res
      }),
    [act],
  )
  const compose = useCallback(() => {
    if (!readOnly) setComposing(true)
  }, [readOnly])

  useEffect(() => {
    setForge(null)
    if (!boardId) return
    void client.forge(boardId).then(setForge).catch(() => setForge(null))
  }, [boardId, client])

  useEffect(() => {
    setPaths({ files: [], dirs: [] })
    if (!boardId) return
    void client
      .files(boardId)
      .then((r) => setPaths({ files: r.files, dirs: r.dirs }))
      .catch(() => setPaths({ files: [], dirs: [] }))
  }, [boardId, client])

  const note = view?.notes.find((n) => n.id === selected) ?? null
  const defaultAgent = agents.find((a) => a.installed && a.authed)?.id ?? null

  useEffect(() => {
    if (note?.runId) void loadTranscript(note.runId)
  }, [note?.runId, loadTranscript])

  // Open and close the pane with the note, keeping whatever width it was
  // dragged to — collapse/expand restores the last size, a resize would not.
  useEffect(() => {
    const panel = detailPanel.current
    if (!panel) return
    // resize() rather than expand(): expand restores whatever the library last
    // saw, which after a reload is nothing.
    if (note) panel.resize(String(detailSize.current))
    else panel.collapse()
  }, [note, detailPanel])

  /** Ordered exactly as the list renders, so j/k match what the eye does. */
  const ordered = useMemo(() => view?.notes.map((n) => n.id) ?? [], [view])

  const move = useCallback(
    (delta: number) => {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-note]")]
      const ids = rows.map((r) => r.dataset["note"]!)
      if (ids.length === 0) return
      const i = selected ? ids.indexOf(selected) : -1
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + delta))]
      if (next) {
        setSelected(next)
        document.querySelector(`[data-note="${next}"]`)?.scrollIntoView({ block: "nearest" })
      }
    },
    [selected],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      if (typing) return

      if (e.key === "Escape") {
        if (composing) setComposing(false)
        else if (selected) setSelected(null)
      }
      if (e.key === "j") move(1)
      if (e.key === "k") move(-1)
      if (e.key === "c" && !readOnly) {
        e.preventDefault()
        setComposing(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [composing, selected, move, ordered, readOnly])

  async function refreshBoards(nextId?: string) {
    const r = await client.boards()
    setBoards(r.boards)
    // Fall through to whatever is left, so removing the open board doesn't
    // leave the app staring at nothing.
    setBoardId(
      (cur) => nextId ?? (r.boards.some((b) => b.id === cur) ? cur : (r.boards[0]?.id ?? null)),
      true,
    )
  }

  return (
    <TeamProvider value={team}>
    <TooltipProvider delayDuration={250}>
    {/* The provider owns the collapsed/expanded state, remembers it, and binds
        ⌘B. It lays out as a flex row, so it replaces the wrapper that was
        doing that by hand. */}
    <SidebarProvider className="h-full" defaultOpen={sidebarWasOpen()}>
      <Backdrop />

      <Sidebar
        boards={boards}
        boardId={boardId}
        /* There are no accounts in kandy — this is whoever owns the machine,
           read off the repo path. A footer that says "Account" and means
           nothing is worse than one that says your name. */
        user={boards[0]?.repoPath.match(/^\/(?:Users|home)\/([^/]+)/)?.[1] ?? "this machine"}
        me={me}
        readOnly={readOnly}
        view={view}
        agents={agents}
        page={page}
        theme={theme}
        onPage={setPage}
        onTheme={setTheme}
        onBoardChange={(id) => {
          setBoardId(id)
          setSelected(null)
        }}
        onNewBoard={() => setNewBoard(true)}
        onNewNote={() => {
          if (readOnly) return
          if (!boardId) return void setNewBoard(true)
          setPage("board")
          setComposing(true)
        }}
      />

      {/*
        The board and the open note split the space, with a handle between
        them. Two hard-coded widths could not be right for both a one-line
        status check and a thousand-line diff, and the size is remembered per
        person rather than decided here.
      */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-w-0 flex-1"
      >
        <ResizablePanel id="board" minSize="28">
          <main className="relative flex h-full min-w-0 flex-col">
        {(error ?? notice) && (
          <button
            onClick={() => {
              clearError()
              setNotice(null)
            }}
            className="shrink-0 border-b border-[#4a2b38] bg-[#241419] px-4 py-2.5 text-left text-aux text-[#efb9cb]"
          >
            {error ?? notice} <span className="ml-2 text-faint">dismiss</span>
          </button>
        )}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            // Only the board has a composer over it to fade against.
            page === "board" && "fade-under-composer",
          )}
        >
          {page === "team" && me.hub ? (
            <TeamPage
              client={client}
              view={view}
              me={me}
              runners={runners}
              recent={recent}
              onRunners={setRunners}
            />
          ) : page === "usage" ? (
            <UsagePage view={view} client={client} />
          ) : page === "settings" ? (
            <SettingsPage
              view={view}
              agents={agents}
              client={client}
              theme={theme}
              onTheme={setTheme}
              onSaved={() => void refreshBoards()}
              onRemoved={() => {
                setPage("board")
                setSelected(null)
                setBoardId(null)
                void refreshBoards()
              }}
            />
          ) : view ? (
            <TriageList
              view={view}
              activity={activity}
              selectedId={selected}
              onSelect={setSelected}
              onCompose={compose}
              onDelete={(id) => {
                // Close the detail pane if it is showing the note being removed.
                setSelected((cur) => (cur === id ? null : cur))
                void act((c) => c.deleteNote(id))
              }}
            />
          ) : boards.length === 0 ? (
            <FirstRun agents={agents} onChooseRepo={() => setNewBoard(true)} />
          ) : (
            <LoadingBlock className="pt-24" label="Opening the board" />
          )}
        </div>

        {/* A viewer has nothing to write with, so the bar is not offered. */}
        {page === "board" && view && boards.length > 0 && !readOnly && (
          <BoardComposer
            agents={agents}
            defaultAgent={defaultAgent}
            paths={paths}
            onExpand={(draft) => {
              setHandoff(draft)
              setComposing(true)
            }}
            onCreate={async (title, agent, model, files) => {
              const column = view.columns[0]?.id
              if (!column) return
              const created = await act((c) =>
                c.createNote(
                  view.board.id,
                  column,
                  title,
                  "",
                  files.map((f) => ({ name: f.name, data: f.data })),
                ),
              )
              if (!created) return
              if (created.rejected?.length)
                setNotice(created.rejected.map((r) => r.reason).join("; "))
              if (agent) await act((c) => c.assignNote(created.noteId, agent))
              if (model) await act((c) => c.setModel(created.noteId, model))
              // A one-liner with an agent picked is meant to go, not to sit.
              if (agent) await runNote(created.noteId, agent)
            }}
          />
        )}
          </main>
        </ResizablePanel>

        {/*
          The detail pane stays mounted and collapses, rather than unmounting
          with its note.

          A panel that comes and goes changes the group's shape, and the group
          saves its layout by shape: on reload the board mounts alone, that
          one-panel layout is written over the two-panel one, and the pane you
          had dragged wider comes back at its default. Collapsing keeps the
          shape — and the remembered width — stable.
        */}
        <ResizableHandle withHandle className={cn(!note && "hidden")} />
        <ResizablePanel
          id="detail"
          panelRef={detailPanel}
          collapsible
          collapsedSize="0"
          defaultSize={String(detailSize.current)}
          onResize={(size) => rememberDetailSize(size.asPercentage)}
          minSize="22"
          maxSize="78"
        >
          {note && view && (
            <NoteDetail
          onWiden={(wide) => detailPanel.current?.resize(wide ? "62" : "34")}
          note={note}
          view={view}
          agents={agents}
          frames={note.runId ? (transcript[note.runId] ?? []) : []}
          activity={note.runId ? activity[note.runId] : undefined}
          forge={forge}
          paths={paths}
          prompts={view.prompts.filter((q) => q.noteId === note.id)}
          onClose={() => setSelected(null)}
          onRun={(agent) => void runNote(note.id, agent)}
          onCancel={(runId) => void act((c) => c.cancelRun(runId))}
          onAssign={(agent) => void act((c) => c.assignNote(note.id, agent))}
          onPolicy={(policy) => void act((c) => c.setPolicy(note.id, policy))}
          onModel={(model) => void act((c) => c.setModel(note.id, model))}
          onEdit={async (patch) => (await act((c) => c.editNote(note.id, patch))) !== undefined}
          onSteer={async (text, files) => {
            const sent = await act((c) =>
              c.message(
                note.id,
                text,
                files?.map((f) => ({ name: f.name, data: f.data })),
              ),
            )
            if (sent?.rejected?.length) setNotice(sent.rejected.map((r) => r.reason).join("; "))
            return sent?.delivery
          }}
          loadStaged={async () => (await act((c) => c.attachments(note.id)))?.attachments ?? []}
          onUnstage={async (name) =>
            (await act((c) => c.unattach(note.id, name)))?.attachments ?? []
          }
          onReview={(decision) => void act((c) => c.reviewNote(note.id, decision))}
          onAnswer={async (prompt, answer) => {
            const res = await act((c) =>
              c.respond(prompt.runId, prompt.requestId, answer.decision, {
                ...(answer.scope ? { scope: answer.scope } : {}),
                ...(answer.comment ? { comment: answer.comment } : {}),
              }),
            )
            // The prompt is gone either way — the stream will drop it. Only an
            // answer that arrived too late needs saying out loud, since the
            // card vanishing would otherwise read as "done".
            if (res && !res.answered) {
              setNotice("That question was already answered or had timed out.")
            }
          }}
          onEscalate={async () => {
            await act((c) => c.escalateNote(note.id))
          }}
          onPrPreview={() => act((c) => c.prPreview(note.id))}
          onOpenPr={async (draft) => {
            await act((c) => c.openPr(note.id, draft))
          }}
          onDelete={() => {
            setSelected(null)
            void act((c) => c.deleteNote(note.id))
          }}
          loadDiff={() => act((c) => c.diff(note.id))}
        />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {composing && view && (
        <Composer
          agents={agents}
          defaultAgent={defaultAgent}
          initialTitle={handoff}
          onCancel={() => {
            setComposing(false)
            setHandoff("")
          }}
          onCreate={async (title, body, agent, model, run, files) => {
            setComposing(false)
            setHandoff("")
            const column = view.columns[0]?.id
            if (!column) return
            // The files travel with the note. They have nowhere else to be —
            // the worktree that will hold them does not exist until it runs.
            const created = await act((c) =>
              c.createNote(
                view.board.id,
                column,
                title,
                body,
                files.map((f) => ({ name: f.name, data: f.data })),
              ),
            )
            if (!created) return
            if (created.rejected?.length) setNotice(created.rejected.map((r) => r.reason).join("; "))
            if (agent) await act((c) => c.assignNote(created.noteId, agent))
            if (model) await act((c) => c.setModel(created.noteId, model))
            if (run && agent) await runNote(created.noteId, agent)
            setSelected(created.noteId)
          }}
        />
      )}

      <NewBoardDialog
        open={newBoard}
        onOpenChange={setNewBoard}
        client={client}
        boards={boards}
        onCreated={(id) => void refreshBoards(id)}
      />

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        view={view}
        boards={boards}
        agents={agents}
        onSelectNote={setSelected}
        onCompose={compose}
        onNewBoard={() => setNewBoard(true)}
        onBoardChange={(id) => {
          setBoardId(id)
          setSelected(null)
        }}
        onRunNote={(noteId, agent) => {
          setSelected(noteId)
          if (readOnly) return
          void (async () => {
            // A failed assign has already said so; running anyway would run
            // whatever agent the note had before.
            if ((await act((c) => c.assignNote(noteId, agent))) === undefined) return
            await runNote(noteId, agent)
          })()
        }}
      />
    </SidebarProvider>
    </TooltipProvider>
    </TeamProvider>
  )
}
