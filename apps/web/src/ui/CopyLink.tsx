import { useEffect, useRef, useState } from "react"
import { Check, Link2 } from "lucide-react"
import { Hint } from "@/ui/Hint"
import { cn } from "@/lib/utils"

/**
 * Copy a link to whatever you are looking at.
 *
 * Every board, note and page has had a real URL since routing landed, but the
 * only way to get one was to read the address bar — which is not where anyone
 * looks in an app that behaves like a desktop tool. This puts the link where
 * the thing is.
 *
 * The daemon is on 127.0.0.1, so a copied link only opens on this machine.
 * That is still the useful case: it is how you keep a note in a commit message,
 * a ticket, or a message to yourself tomorrow.
 */
export function CopyLink({
  path,
  label = "Copy link",
  className,
  size = 3.5,
}: {
  /** Absolute app path, e.g. `/b/<board>/n/<note>`. */
  path: string
  label?: string
  className?: string
  size?: number
}) {
  const [done, setDone] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // A pending "Copied" must not outlive the button that is showing it.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard access can be refused; a selected, copyable fallback beats
      // a button that silently does nothing.
      window.prompt("Copy this link", url)
      return
    }
    setDone(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(false), 1400)
  }

  return (
    <Hint text={done ? "Copied" : label}>
      <button
        type="button"
        onClick={(e) => {
          // These sit inside rows that select a note; copying is not selecting.
          e.stopPropagation()
          void copy()
        }}
        aria-label={label}
        className={cn(
          "text-muted-foreground/70 hover:bg-accent hover:text-foreground grid place-items-center rounded-md p-1 transition",
          done && "text-mint hover:text-mint",
          className,
        )}
      >
        {done ? (
          <Check style={{ width: `${size * 4}px`, height: `${size * 4}px` }} />
        ) : (
          <Link2 style={{ width: `${size * 4}px`, height: `${size * 4}px` }} />
        )}
      </button>
    </Hint>
  )
}
