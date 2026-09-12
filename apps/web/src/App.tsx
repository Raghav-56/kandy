import { useEffect, useMemo, useState } from "react"
import { KandyClient } from "@kandy/client"
import type { AgentId, AgentInfo, Board } from "@kandy/core"
import { useBoard } from "./useBoard"
import { Board3D } from "./components/Board3D"
import { Composer } from "./components/Composer"
import { Inspector } from "./components/Inspector"
import { NewBoardDialog } from "./components/NewBoardDialog"
import { TopBar } from "./components/TopBar"
import { Button } from "@/components/ui/button"

export function App() {
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [composeIn, setComposeIn] = useState<string | null>(null)
  const [newBoard, setNewBoard] = useState(false)

  const { client, view, connected, error, act, transcript, loadTranscript, clearError } =
    useBoard(boardId)

  const bootstrap = useMemo(() => new KandyClient({ baseUrl: "/api" }), [])

  useEffect(() => {
    void bootstrap.boards().then((r) => {
      setBoards(r.boards)
      setBoardId((id) => id ?? r.boards[0]?.id ?? null)
    })
    void bootstrap.agents().then((r) => setAgents(r.agents))
  }, [bootstrap])

  const note = view?.notes.find((n) => n.id === selected) ?? null
  const running = view?.notes.filter((n) => n.status === "running").length ?? 0
  const blocked = view?.notes.filter((n) => n.status === "blocked").length ?? 0
  const defaultAgent = agents.find((a) => a.installed && a.authed)?.id ?? null

  // Pull a note's history from disk when it's opened — the live stream only
  // carries what happened while this tab was watching.
  useEffect(() => {
    if (note?.runId) void loadTranscript(note.runId)
  }, [note?.runId, loadTranscript])

  // Escape closes whatever is open, innermost first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (composeIn) setComposeIn(null)
      else if (selected) setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [composeIn, selected])

  async function refreshBoards(nextId?: string) {
    const r = await bootstrap.boards()
    setBoards(r.boards)
    if (nextId) setBoardId(nextId)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        boards={boards}
        boardId={boardId}
        onBoardChange={(id) => {
          setBoardId(id)
          setSelected(null)
        }}
        onNewBoard={() => setNewBoard(true)}
        repoPath={view?.board.repoPath}
        agents={agents}
        connected={connected}
        running={running}
        blocked={blocked}
      />

      {error && (
        <button
          onClick={clearError}
          className="shrink-0 bg-paper-white px-6 py-3 text-left text-[12px] text-obsidian"
        >
          {error} — dismiss
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {view ? (
            <Board3D
              view={view}
              selectedId={selected}
              onSelect={setSelected}
              onMove={(noteId, columnId, afterId) =>
                void act((c) =>
                  c.moveNote(noteId, columnId, afterId ? { after: afterId } : {}),
                )
              }
              onCompose={setComposeIn}
            />
          ) : (
            <Empty hasBoards={boards.length > 0} onNewBoard={() => setNewBoard(true)} />
          )}
        </main>

        {note && view && (
          <Inspector
            note={note}
            view={view}
            agents={agents}
            frames={note.runId ? (transcript[note.runId] ?? []) : []}
            onClose={() => setSelected(null)}
            onRun={(agent) => void act((c) => c.runNote(note.id, agent))}
            onCancel={(runId) => void act((c) => c.cancelRun(runId))}
            onAssign={(agent) => void act((c) => c.assignNote(note.id, agent))}
            onSteer={async (text) => (await act((c) => c.message(note.id, text)))?.delivery}
            onReview={(decision) => void act((c) => c.reviewNote(note.id, decision))}
            onDelete={() => {
              setSelected(null)
              void act((c) => c.deleteNote(note.id))
            }}
            loadDiff={() => act((c) => c.diff(note.id))}
          />
        )}
      </div>

      {composeIn && view && (
        <Composer
          agents={agents}
          defaultAgent={defaultAgent}
          onCancel={() => setComposeIn(null)}
          onCreate={async (title, agent, run) => {
            setComposeIn(null)
            const created = await act((c) => c.createNote(view.board.id, composeIn, title))
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
        client={bootstrap}
        onCreated={(id) => void refreshBoards(id)}
      />
    </div>
  )
}

function Empty({ hasBoards, onNewBoard }: { hasBoards: boolean; onNewBoard: () => void }) {
  return (
    <div className="flex h-full items-center">
      <div className="px-16">
        <h1 className="display display-lg max-w-[12ch]">
          {hasBoards ? "Loading" : "Nothing on the wall"}
        </h1>
        <p className="mt-10 max-w-[46ch] text-[22px] leading-[1.18] tracking-[-0.44px] text-[#d4d4d4]">
          A board is a git repository. Every note you write becomes a unit of work an agent picks
          up — in its own worktree, on its own branch.
        </p>
        <div className="mt-10">
          <Button variant="solid" size="lg" onClick={onNewBoard}>
            New board
          </Button>
        </div>
      </div>
    </div>
  )
}
