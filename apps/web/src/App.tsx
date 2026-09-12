import { useEffect, useState } from "react"
import { KandyClient } from "@kandy/client"
import { notesIn, type AgentInfo, type Board, type Note } from "@kandy/core"
import { useBoard } from "./useBoard.js"

export function App() {
  const [boards, setBoards] = useState<Board[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const { client, view, connected, error, act, clearError } = useBoard(boardId)

  useEffect(() => {
    const c = new KandyClient({ baseUrl: "/api" })
    void c.boards().then((r) => {
      setBoards(r.boards)
      setBoardId((id) => id ?? r.boards[0]?.id ?? null)
    })
    void c.agents().then((r) => setAgents(r.agents))
  }, [])

  if (!boardId) return <Empty />

  return (
    <div className="app">
      <header className="bar">
        <span className="logo">kandy</span>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <span className="repo">{view?.board.repoPath}</span>
        <span className="spacer" />
        <AgentPills agents={agents} />
        <span className={connected ? "dot dot-on" : "dot dot-off"} title={connected ? "live" : "reconnecting"} />
      </header>

      {error && (
        <div className="error" onClick={clearError} role="alert">
          {error} <span className="dismiss">dismiss</span>
        </div>
      )}

      <main className="board">
        {view?.columns.map((col) => (
          <Column
            key={col.id}
            name={col.name}
            notes={notesIn(view, col.id)}
            onDrop={(noteId, afterId) =>
              act((c) => c.moveNote(noteId, col.id, afterId ? { after: afterId } : {}))
            }
            onAdd={(title) => act((c) => c.createNote(view.board.id, col.id, title))}
          >
            {(note) => (
              <NoteCard
                key={note.id}
                note={note}
                agents={agents}
                onRun={() => act((c) => c.runNote(note.id))}
                onAssign={(a) => act((c) => c.assignNote(note.id, a))}
                onDelete={() => act((c) => c.deleteNote(note.id))}
              />
            )}
          </Column>
        ))}
      </main>
    </div>
  )
}

function Column({
  name,
  notes,
  children,
  onDrop,
  onAdd,
}: {
  name: string
  notes: Note[]
  children: (n: Note) => React.ReactNode
  onDrop: (noteId: string, afterId: string | null) => void
  onAdd: (title: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [over, setOver] = useState(false)

  return (
    <section
      className={over ? "col col-over" : "col"}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const noteId = e.dataTransfer.getData("text/note-id")
        if (noteId) onDrop(noteId, notes.at(-1)?.id ?? null)
      }}
    >
      <h2>
        {name} <span className="count">{notes.length}</span>
      </h2>

      <div className="stack">{notes.map(children)}</div>

      {adding ? (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            const input = new FormData(e.currentTarget).get("title")
            if (typeof input === "string" && input.trim()) onAdd(input.trim())
            setAdding(false)
          }}
        >
          <textarea
            name="title"
            autoFocus
            rows={2}
            placeholder="What should the agent do?"
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false)
              if (e.key === "Enter" && !e.shiftKey) e.currentTarget.form?.requestSubmit()
            }}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </form>
      ) : (
        <button className="add" onClick={() => setAdding(true)}>
          + note
        </button>
      )}
    </section>
  )
}

function NoteCard({
  note,
  agents,
  onRun,
  onAssign,
  onDelete,
}: {
  note: Note
  agents: AgentInfo[]
  onRun: () => void
  onAssign: (a: import("@kandy/core").AgentId) => void
  onDelete: () => void
}) {
  const runnable = note.status === "draft" || note.status === "failed"
  return (
    <article
      className={`note note-${note.status}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/note-id", note.id)}
    >
      <div className="note-head">
        <span className={`status status-${note.status}`}>{note.status}</span>
        <button className="x" onClick={onDelete} aria-label="delete note">
          ×
        </button>
      </div>

      <p className="title">{note.title}</p>

      {note.branch && <code className="branch">{note.branch}</code>}

      <div className="note-foot">
        <select
          value={note.agent ?? ""}
          onChange={(e) => onAssign(e.target.value as import("@kandy/core").AgentId)}
        >
          <option value="" disabled>
            agent…
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.installed}>
              {a.id}
              {a.installed ? "" : " (not installed)"}
            </option>
          ))}
        </select>
        {runnable && note.agent && (
          <button className="run" onClick={onRun}>
            run
          </button>
        )}
      </div>
    </article>
  )
}

function AgentPills({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="pills">
      {agents.map((a) => (
        <span
          key={a.id}
          className={a.installed && a.authed ? "pill pill-ok" : "pill"}
          title={
            a.installed
              ? a.authed
                ? `${a.version ?? "installed"} — authenticated`
                : "installed, not authenticated"
              : "not installed"
          }
        >
          {a.id}
        </span>
      ))}
    </div>
  )
}

function Empty() {
  return (
    <div className="empty">
      <h1>kandy</h1>
      <p>No boards yet. Create one against a git repo:</p>
      <pre>
        curl -X POST http://127.0.0.1:4477/boards \{"\n"}
        {"  "}-H 'content-type: application/json' \{"\n"}
        {"  "}-d {"'"}{`{"name":"my project","repoPath":"/abs/path/to/repo"}`}{"'"}
      </pre>
      <p className="hint">Then reload. A board-creation UI is on the roadmap.</p>
    </div>
  )
}
