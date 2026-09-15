import { useEffect, useMemo, useState } from "react"
import { FolderGit2, Search } from "lucide-react"
import type { KandyClient } from "@kandy/client"
import type { DirEntry } from "@kandy/core"
import { Button } from "@/ui"
import { cn, tailPath } from "@/lib/utils"

/**
 * Choosing the repo, in one field.
 *
 * This replaced a folder tree and a mode toggle. Browsing meant reading past
 * Applications and DaVinci Resolve Media to reach the four directories that
 * could ever be an answer, and "type a path" was a second mode you had to
 * switch into — so the dialog asked how you wanted to work before it asked
 * anything about your repo.
 *
 * One field does both. Typing filters the repos the daemon found; typing
 * something shaped like a path is taken as one, because someone who knows
 * where their repo lives shouldn't have to find a different control for it.
 * The native chooser stays for anything kept somewhere unusual.
 */
export function RepoPicker({
  client,
  query,
  onQuery,
  onPick,
  taken,
}: {
  client: KandyClient
  /** The field's text. Owned by the dialog, which also validates it. */
  query: string
  onQuery: (v: string) => void
  onPick: (path: string) => void
  /** Repo paths that already have a board, so they can say so. */
  taken: Set<string>
}) {
  const [repos, setRepos] = useState<DirEntry[]>([])
  const [pick, setPick] = useState(0)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    let stale = false
    void client
      .browse()
      .then((r) => !stale && setRepos(r.repos ?? []))
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [client])

  /* A path is anything with a separator or a leading ~ — the one shape that
     can't also be someone searching for a repo by name. */
  const isPath = /[/~]/.test(query)

  const hits = useMemo(() => {
    if (isPath) return []
    const q = query.trim().toLowerCase()
    /* Matched on the name alone. Matching the path too looked more generous
       and was worse: every repo lives under ~/Developer, so "eve" returned
       every repo on the machine. */
    const matches = q ? repos.filter((r) => r.name.toLowerCase().includes(q)) : repos
    return matches
      .slice()
      .sort((a, b) => {
        // Repos you've already added sort last: you came here to add a new one.
        const at = taken.has(a.path) ? 1 : 0
        const bt = taken.has(b.path) ? 1 : 0
        if (at !== bt) return at - bt
        if (!q) return 0
        const an = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return an - bn || a.name.length - b.name.length
      })
      .slice(0, 6)
  }, [query, repos, isPath, taken])

  useEffect(() => setPick(0), [query])

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 transition-colors focus-within:border-grape/45">
        <Search className="size-3.5 shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search your repos, or paste a path"
          className={cn(
            "w-full bg-transparent py-2 text-[13px] outline-none placeholder:text-faint",
            isPath && "font-mono",
          )}
          onKeyDown={(e) => {
            if (hits.length === 0) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setPick((i) => (i + 1) % hits.length)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setPick((i) => (i - 1 + hits.length) % hits.length)
            } else if (e.key === "Enter" && !isPath) {
              e.preventDefault()
              onPick(hits[pick]!.path)
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={browsing}
          onClick={async () => {
            setBrowsing(true)
            try {
              const { path } = await client.pickFolder()
              if (path) onPick(path)
            } finally {
              setBrowsing(false)
            }
          }}
          className="-mr-1.5 shrink-0 text-dim"
        >
          {browsing ? "Choosing…" : "Browse…"}
        </Button>
      </div>

      {hits.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-hairline">
          {hits.map((r, i) => (
            <li key={r.path}>
              <button
                type="button"
                onMouseEnter={() => setPick(i)}
                onClick={() => onPick(r.path)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                  i === pick ? "bg-raised" : "hover:bg-raised/60",
                )}
              >
                <FolderGit2 className="size-3.5 shrink-0 text-faint" />
                <span className="text-[12.5px] text-ink">{r.name}</span>
                {taken.has(r.path) && <span className="text-[10.5px] text-faint">on a board</span>}
                {/* The parent, not the path: the name is already the row's
                    subject, and repeating it makes the line read twice. */}
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-faint">
                  {tailPath(r.path.replace(/^\/Users\/[^/]+/, "~").replace(/\/[^/]+$/, ""), 30)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
