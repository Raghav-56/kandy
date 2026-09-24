import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Copy some text, and say so for a moment.
 *
 * Shared by every copy control that is not a link, so "Copied" lasts the same
 * time and a refused clipboard falls back the same way everywhere.
 */
export function useCopy(ms = 1400): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // A pending "Copied" must not outlive the control showing it.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Clipboard access is refused outside a secure context — which a hub
        // reached over plain http on a tailnet often is. A selectable prompt
        // beats a button that silently does nothing.
        window.prompt("Copy this", text)
        return
      }
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), ms)
    },
    [ms],
  )

  return { copied, copy }
}

/** A small Copy button for any text, with the same brief "Copied". */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const { copied, copy } = useCopy()
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => void copy(text)}
      className={cn("text-muted-foreground shrink-0", copied && "text-mint hover:text-mint", className)}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  )
}

/**
 * One shell command, ready to paste.
 *
 * Onboarding is mostly "run this on your laptop", and a command typed from a
 * screen is a command mistyped — so each one is shown whole, in mono, with
 * its own copy button rather than inline in a sentence.
 */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        "border-hairline bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg border py-1 pr-1 pl-2.5",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-aux" title={command}>
        {command}
      </code>
      <CopyButton text={command} />
    </div>
  )
}
