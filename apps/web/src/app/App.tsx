import { useCallback, useEffect, useMemo, useState } from "react"
import { KandyClient } from "@kandy/client"
import type { AgentId, AgentInfo, Board, Forge } from "@kandy/core"
import { Button, Empty } from "@/ui"
import { Backdrop } from "@/brand/Backdrop"
import { Logo } from "@/brand/Logo"
import { Composer } from "@/features/notes/Composer"
import { NewBoardDialog } from "@/features/boards/NewBoardDialog"
import { useBoard } from "@/hooks/useBoard"
import { CommandPalette } from "./CommandPalette"
import { NoteDetail } from "./NoteDetail"
import { Sidebar } from "./Sidebar"
import { TriageList } from "./TriageList"

export function App() {
  const client = useMemo(() => new KandyClient({ baseUrl: "/api" }), [])
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [forge, setForge] = useState<Forge | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [newBoard, setNewBoard] = useState(false)
  const [palette, setPalette] = useState(false)

  const { view, connected, error, act, transcript, activity, loadTranscript, clearError } =
    useBoard(boardId)

  useEffect(() => {
    void client.boards().then((r) => {
      setBoards(r.boards)
      setBoardId((id) => id ?? r.boards[0]?.id ?? null)
    })
    void client.agents().then((r) => setAgents(r.agents))
  }, [client])

  useEffect(() => {
    setForge(null)
    if (!boardId) return
    void client.forge(boardId).then(setForge).catch(() => setForge(null))
  }, [boardId, client])

  const note = view?.notes.find((n) => n.id === selected) ?? null
  const defaultAgent = agents.find((a) => a.installed && a.authed)?.id ?? null

  useEffect(() => {
    if (note?.runId) void loadTranscript(note.runId)
  }, [note?.runId, loadTranscript])

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
      if (e.key === "c") {
        e.preventDefault()
        setComposing(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [composing, selected, move, ordered])

  async function refreshBoards(nextId?: string) {
    const r = await client.boards()
    setBoards(r.boards)
    if (nextId) setBoardId(nextId)
  }

  return (
    <div className="flex h-full">
      <Backdrop />

      <Sidebar
        boards={boards}
        boardId={boardId}
        view={view}
        agents={agents}
        connected={connected}
        onBoardChange={(id) => {
          setBoardId(id)
          setSelected(null)
        }}
        onNewBoard={() => setNewBoard(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <button
            onClick={clearError}
            className="shrink-0 border-b border-[#4a2b38] bg-[#241419] px-5 py-2.5 text-left text-[12px] text-[#efb9cb]"
          >
            {error} <span className="ml-2 text-faint">dismiss</span>
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view ? (
            <TriageList
              view={view}
              activity={activity}
              selectedId={selected}
              onSelect={setSelected}
              onCompose={() => setComposing(true)}
            />
          ) : boards.length === 0 ? (
            <Empty
              className="pt-[18vh]"
              icon={<Logo size={44} />}
              title="Point kandy at a repository"
              body="Every note you write becomes one job for one agent — run in its own worktree, on its own branch, so several can work at once without colliding."
              action={
                <Button tone="primary" size="md" onClick={() => setNewBoard(true)}>
                  Choose a repo
                </Button>
              }
            />
          ) : (
            <p className="pt-24 text-center text-[12px] text-faint">Loading…</p>
          )}
        </div>
      </main>

      {note && view && (
        <NoteDetail
          note={note}
          view={view}
          agents={agents}
          frames={note.runId ? (transcript[note.runId] ?? []) : []}
          activity={note.runId ? activity[note.runId] : undefined}
          forge={forge}
          onClose={() => setSelected(null)}
          onRun={(agent) => void act((c) => c.runNote(note.id, agent))}
          onCancel={(runId) => void act((c) => c.cancelRun(runId))}
          onAssign={(agent) => void act((c) => c.assignNote(note.id, agent))}
          onPolicy={(policy) => void act((c) => c.setPolicy(note.id, policy))}
          onEdit={async (patch) => (await act((c) => c.editNote(note.id, patch))) !== undefined}
          onSteer={async (text) => (await act((c) => c.message(note.id, text)))?.delivery}
          onReview={(decision) => void act((c) => c.reviewNote(note.id, decision))}
          onOpenPr={async () => {
            await act((c) => c.openPr(note.id))
          }}
          onDelete={() => {
            setSelected(null)
            void act((c) => c.deleteNote(note.id))
          }}
          loadDiff={() => act((c) => c.diff(note.id))}
        />
      )}

      {composing && view && (
        <Composer
          agents={agents}
          defaultAgent={defaultAgent}
          onCancel={() => setComposing(false)}
          onCreate={async (title, body, agent, run) => {
            setComposing(false)
            const column = view.columns[0]?.id
            if (!column) return
            const created = await act((c) => c.createNote(view.board.id, column, title, body))
            if (!created) return
            if (agent) await act((c) => c.assignNote(created.noteId, agent))
            if (run && agent) await act((c) => c.runNote(created.noteId, agent))
            setSelected(created.noteId)
          }}
        />
      )}

      <NewBoardDialog
        open={newBoard}
        onOpenChange={setNewBoard}
        client={client}
        onCreated={(id) => void refreshBoards(id)}
      />

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        view={view}
        boards={boards}
        agents={agents}
        onSelectNote={setSelected}
        onCompose={() => setComposing(true)}
        onNewBoard={() => setNewBoard(true)}
        onBoardChange={(id) => {
          setBoardId(id)
          setSelected(null)
        }}
        onRunNote={(noteId, agent) => {
          setSelected(noteId)
          void act(async (c) => {
            await c.assignNote(noteId, agent)
            return c.runNote(noteId, agent)
          })
        }}
      />
    </div>
  )
}
