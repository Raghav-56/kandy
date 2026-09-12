import { useEffect, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { RepoCheck } from "@kandy/core"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * A board is a repo. Validating the path while it's typed — rather than at the
 * first run, three clicks later — is the difference between a tool that feels
 * solid and one that feels like it's guessing.
 */
export function NewBoardDialog({
  open,
  onOpenChange,
  client,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  client: KandyClient
  onCreated: (boardId: string) => void
}) {
  const [path, setPath] = useState("")
  const [name, setName] = useState("")
  const [check, setCheck] = useState<RepoCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path.trim()) return setCheck(null)
    let stale = false
    // Debounced: the user is still typing a path, and every keystroke would
    // otherwise be a git process.
    const t = setTimeout(() => {
      void client
        .checkRepo(path.trim())
        .then((r) => !stale && setCheck(r))
        .catch(() => !stale && setCheck(null))
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [path, client])

  async function create() {
    if (!check?.isRepo || busy) return
    setBusy(true)
    setError(null)
    try {
      const { board } = await client.createBoard(name.trim() || check.name || "board", check.path)
      onCreated(board.id)
      onOpenChange(false)
      setPath("")
      setName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New board</DialogTitle>
        <DialogDescription>
          Point it at a git repository. Every note runs in its own worktree off that repo.
        </DialogDescription>

        <div className="mt-10 space-y-6">
          <label className="block">
            <span className="display display-xs text-ash">Repository path</span>
            <Input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/Developer/kandy"
              className="mt-3 font-mono"
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <RepoStatus path={path} check={check} />
          </label>

          <label className="block">
            <span className="display display-xs text-ash">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={check?.name ?? "optional — defaults to the folder name"}
              className="mt-3"
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </label>
        </div>

        {error && <p className="mt-6 bg-paper-white px-3 py-2 text-[12px] text-obsidian">{error}</p>}

        <div className="mt-10 flex items-center gap-4">
          <Button variant="solid" size="md" disabled={!check?.isRepo || busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create board"}
          </Button>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RepoStatus({ path, check }: { path: string; check: RepoCheck | null }) {
  if (!path.trim()) return <p className="meta mt-3">Absolute path, or ~ for home.</p>
  if (!check) return <p className="meta mt-3">Checking…</p>

  if (!check.isRepo) {
    return <p className="mt-3 text-[12px] text-paper-white">{check.error ?? "Not a git repository."}</p>
  }

  return (
    <div className="meta mt-3 space-y-1">
      <div className="font-mono text-[#d4d4d4]">{check.path}</div>
      <div>
        on {check.branch} at {check.head}
      </div>
      {/* Worth saying plainly: notes branch from HEAD and will not see
          uncommitted work. Discovering that later feels like a betrayal. */}
      {check.dirty && (
        <div className="text-paper-white">
          Uncommitted changes — agents branch from HEAD and won't see them.
        </div>
      )}
    </div>
  )
}
