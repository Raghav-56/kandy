import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { splitFiles } from "./parse"

/**
 * A diff with a file list, not one long scroll.
 *
 * Reviewing agent output means asking "what did it touch" before "what did it
 * write". Splitting per file answers the first question at a glance and keeps
 * the second from being a two-thousand-line wall.
 */
export function DiffView({
  diff,
  capturedAt,
}: {
  diff: string
  /** Set when the worktree is gone and this is the snapshot taken at review. */
  capturedAt?: number | null
}) {
  const files = useMemo(() => splitFiles(diff), [diff])
  const [open, setOpen] = useState<string | null>(files[0]?.path ?? null)

  if (files.length === 0) {
    return <p className="flex-1 px-4 py-6 text-center text-aux text-faint">No changes yet.</p>
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {capturedAt != null && (
        <p className="mb-2.5 px-1 text-meta text-faint">
          Snapshot from review on {new Date(capturedAt).toLocaleString()} — the worktree is gone.
        </p>
      )}
      <div className="space-y-2">
        {files.map((f) => {
          const isOpen = open === f.path
          return (
            <div key={f.path} className="overflow-hidden rounded-xl border border-hairline">
              <button
                onClick={() => setOpen(isOpen ? null : f.path)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left leading-none transition-colors",
                  isOpen ? "bg-raised" : "bg-surface hover:bg-raised/60",
                )}
              >
                {/* An icon, not a ▶ glyph: the character carries its own
                    baseline and font metrics, so it never sits on the same
                    line as the text beside it. */}
                <ChevronRight
                  className={cn(
                    "text-muted-foreground size-3.5 shrink-0 transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                <span className="truncate font-mono text-aux leading-none" title={f.path}>
                  {f.path}
                </span>
                <span className="ml-auto shrink-0 text-meta leading-none tabular-nums">
                  <span className="text-mint">+{f.added}</span>{" "}
                  <span className="text-berry">−{f.removed}</span>
                </span>
              </button>

              {isOpen && (
                /* Theme tokens rather than fixed hexes: a hard-coded dark block
                   in the light theme put pale @@ bands between black ones. */
                <pre className="overflow-x-auto border-t border-hairline bg-bg py-2 font-mono text-meta leading-[1.6]">
                  {f.lines.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        "px-3 whitespace-pre",
                        l.startsWith("+") && "bg-mint-bg text-mint",
                        l.startsWith("-") && "bg-berry-bg text-berry",
                        l.startsWith("@@") && "my-1 bg-sky-bg text-sky",
                        !/^[-+@]/.test(l) && "text-dim",
                      )}
                    >
                      {l || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
