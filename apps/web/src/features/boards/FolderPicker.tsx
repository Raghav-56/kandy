import { useEffect, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { DirEntry, Listing } from "@kandy/core"
import { Button } from "@/ui"
import { cn } from "@/lib/utils"

/**
 * Choose a repo by looking at the machine, not by typing a path.
 *
 * A browser cannot give us a directory path — `webkitdirectory` hands over
 * file handles, and we need a path to run git in. The daemon is local, so it
 * lists directories for us, and on macOS it can open the real OS chooser.
 * Repos are marked and sorted first, because in a folder of forty things you
 * are looking for the eight that are projects.
 */
export function FolderPicker({
  client,
  onPick,
}: {
  client: KandyClient
  onPick: (path: string) => void
}) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [native, setNative] = useState(false)

  async function go(path?: string) {
    setLoading(true)
    try {
      const l = await client.browse(path)
      setListing(l)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void go()
  }, [])

  async function chooseNatively() {
    setNative(true)
    try {
      const { path } = await client.pickFolder()
      if (path) onPick(path)
    } finally {
      setNative(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <header className="flex items-center gap-2 border-b border-hairline bg-raised px-2.5 py-2">
        <button
          disabled={!listing?.parent}
          onClick={() => listing?.parent && void go(listing.parent)}
          aria-label="Up one folder"
          className="flex h-6 w-6 items-center justify-center rounded-md text-dim transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
        >
          ↑
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-dim" dir="rtl">
          {listing?.path.replace(/^\/Users\/[^/]+/, "~") ?? "…"}
        </span>
        <Button size="sm" tone="ghost" onClick={() => void chooseNatively()} disabled={native}>
          {native ? "Choosing…" : "Browse…"}
        </Button>
      </header>

      {listing && listing.suggestions.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-hairline px-2.5 py-2">
          {listing.suggestions.map((s) => (
            <button
              key={s.path}
              onClick={() => void go(s.path)}
              className="rounded-md bg-raised px-2 py-1 text-[11px] text-dim transition-colors hover:text-ink"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[240px] overflow-y-auto">
        {loading && <p className="px-3 py-6 text-center text-[12px] text-faint">Reading…</p>}

        {!loading && listing?.entries.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-faint">Nothing in here.</p>
        )}

        {!loading &&
          listing?.entries.map((e) => (
            <Row key={e.path} entry={e} onOpen={() => void go(e.path)} onPick={() => onPick(e.path)} />
          ))}
      </div>

      {listing?.isRepo && (
        <div className="flex items-center gap-2 border-t border-hairline bg-raised px-2.5 py-2">
          <span className="flex-1 text-[11.5px] text-mint">This folder is a repository</span>
          <Button size="sm" tone="primary" onClick={() => onPick(listing.path)}>
            Use this
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({
  entry,
  onOpen,
  onPick,
}: {
  entry: DirEntry
  onOpen: () => void
  onPick: () => void
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-raised",
      )}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cn("shrink-0 text-[13px]", entry.isRepo ? "text-mint" : "text-faint")}>
          {entry.isRepo ? "◆" : "▸"}
        </span>
        <span className={cn("truncate text-[12.5px]", entry.isRepo ? "text-ink" : "text-dim")}>
          {entry.name}
        </span>
      </button>
      {entry.isRepo && (
        <button
          onClick={onPick}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        >
          Select
        </button>
      )}
    </div>
  )
}
