import { useEffect, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { RepoCheck } from "@kandy/core"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FolderPicker } from "./FolderPicker"
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
  // Browsing is the default; typing is the escape hatch for people who already
  // know the path and would rather not click through to it.
  const [typing, setTyping] = useState(false)
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

        <div className="mt-6 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="label">Repository</span>
              <button
                onClick={() => setTyping((t) => !t)}
                className="text-[11px] text-faint transition-colors hover:text-dim"
              >
                {typing ? "browse instead" : "type a path"}
              </button>
            </div>

            <div className="mt-1.5">
              {typing ? (
                <Input
                  autoFocus
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="~/Developer/kandy"
                  className="font-mono"
                  onKeyDown={(e) => e.key === "Enter" && void create()}
                />
              ) : (
                <FolderPicker
                  client={client}
                  onPick={(p) => {
                    setPath(p)
                    setTyping(true)
                  }}
                />
              )}
            </div>

            {(typing || path) && <RepoStatus path={path} check={check} />}
          </div>

          <label className="block">
            <span className="label">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={check?.name ?? "optional — defaults to the folder name"}
              className="mt-1.5"
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-[#3d2621] bg-[#1d1312] px-3 py-2 text-[12px] text-[#e8b3a8]">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2">
          <Button
            variant="solid"
            size="md"
            disabled={!check?.isRepo || busy}
            onClick={() => void create()}
          >
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
  if (!path.trim())
    return <p className="mt-2 text-[11.5px] text-faint">Absolute path, or ~ for home.</p>
  if (!check) return <p className="mt-2 text-[11.5px] text-faint">Checking…</p>

  if (!check.isRepo) {
    return <p className="mt-2 text-[11.5px] text-coral">{check.error ?? "Not a git repository."}</p>
  }

  return (
    <div className="mt-2 space-y-1 text-[11.5px]">
      <div className="flex items-center gap-1.5 text-sage">
        <span className="h-1.5 w-1.5 rounded-full bg-sage" />
        <span className="font-mono text-dim">{check.path}</span>
      </div>
      <div className="text-faint">
        on {check.branch} at {check.head}
      </div>
      {/* Worth saying plainly: notes branch from HEAD and will not see
          uncommitted work. Discovering that later feels like a betrayal. */}
      {check.dirty && (
        <div className="text-amber">
          Uncommitted changes — agents branch from HEAD and won't see them.
        </div>
      )}
    </div>
  )
}
