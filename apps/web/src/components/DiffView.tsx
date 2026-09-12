import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"

type FileDiff = {
  path: string
  lines: string[]
  added: number
  removed: number
}

/**
 * A diff with a file list, not one long scroll.
 *
 * Reviewing agent output means asking "what did it touch" before "what did it
 * write". Splitting per file answers the first question at a glance and keeps
 * the second from being a two-thousand-line wall.
 */
export function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => splitFiles(diff), [diff])
  const [open, setOpen] = useState<string | null>(files[0]?.path ?? null)

  if (files.length === 0) {
    return <p className="flex-1 px-5 py-6 text-center text-[12px] text-faint">No changes yet.</p>
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="space-y-2">
        {files.map((f) => {
          const isOpen = open === f.path
          return (
            <div key={f.path} className="overflow-hidden rounded-xl border border-line-soft">
              <button
                onClick={() => setOpen(isOpen ? null : f.path)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors",
                  isOpen ? "bg-panel-2" : "bg-panel hover:bg-panel-2/60",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 text-[10px] text-faint transition-transform",
                    isOpen && "rotate-90",
                  )}
                >
                  ▶
                </span>
                <span className="truncate font-mono text-[12px] text-ink" title={f.path}>
                  {f.path}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums">
                  <span className="text-sage">+{f.added}</span>{" "}
                  <span className="text-coral">−{f.removed}</span>
                </span>
              </button>

              {isOpen && (
                <pre className="overflow-x-auto border-t border-line-soft bg-[#0c0c0e] py-2 font-mono text-[11.5px] leading-[1.6]">
                  {f.lines.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        "px-3.5 whitespace-pre",
                        l.startsWith("+") && "bg-[#0f1c0d] text-[#a5d68f]",
                        l.startsWith("-") && "bg-[#1e0f0e] text-[#e0918a]",
                        l.startsWith("@@") && "my-1 bg-panel-2 text-azure",
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

function splitFiles(diff: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // "diff --git a/x b/x" — the b-side is the path after a rename.
      const path = line.split(" b/").pop() ?? line
      current = { path, lines: [], added: 0, removed: 0 }
      files.push(current)
      continue
    }
    if (!current) continue
    // Headers are noise once the filename is its own row.
    if (/^(index |--- |\+\+\+ |new file |deleted file |similarity |rename )/.test(line)) continue

    current.lines.push(line)
    if (line.startsWith("+")) current.added++
    else if (line.startsWith("-")) current.removed++
  }
  return files
}
