import { useEffect, useRef, useState } from "react"
import { Check, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/ui/Hint"
import { cn } from "@/lib/utils"

/**
 * Copy a link to whatever you are looking at.
 *
 * Every board and note has had a real URL since routing landed, and the only
 * way to get one was to read the address bar — which is not where anyone looks
 * in something that behaves like a desktop app.
 *
 * Built on the same Button as whatever it sits beside, and takes the same
 * `size`. The first version was a hand-rolled button with its own padding,
 * radius and inline icon sizing, which put a 22px control next to the 32px
 * ones it shared a row with.
 *
 * The daemon is on 127.0.0.1, so a copied link only opens on this machine.
 * That is still the useful case: it is how a note ends up in a commit message,
 * a ticket, or a message to yourself tomorrow.
 */
export function CopyLink({
  path,
  label = "Copy link",
  size = "icon",
  className,
}: {
  /** Absolute app path, e.g. `/b/<board>/n/<note>`. */
  path: string
  label?: string
  /** Match the controls beside it. */
  size?: "icon" | "icon-xs" | "icon-sm"
  className?: string
}) {
  const [done, setDone] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // A pending "Copied" must not outlive the button showing it.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard access can be refused; a selectable fallback beats a button
      // that silently does nothing.
      window.prompt("Copy this link", url)
      return
    }
    setDone(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(false), 1400)
  }

  const Icon = done ? Check : Link2

  return (
    <Hint text={done ? "Copied" : label}>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={label}
        onClick={(e) => {
          // These sit inside rows that select a note; copying is not selecting.
          e.stopPropagation()
          void copy()
        }}
        className={cn(done && "text-mint hover:text-mint", className)}
      >
        <Icon className={size === "icon-xs" ? "size-3" : "size-3.5"} />
      </Button>
    </Hint>
  )
}
