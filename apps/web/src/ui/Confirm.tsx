import type { ReactNode } from "react"
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui"
import { cn } from "@/lib/utils"

/**
 * Ask before doing something that is hard to take back.
 *
 * The rule is that the dialog must say what will actually happen to *this*
 * thing — which branch, how many files, where it lands — not "Are you sure?".
 * A confirmation that carries no information is a speed bump, and people learn
 * to click through speed bumps without reading.
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  facts,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: ReactNode
  /** Concrete specifics: the branch, the counts, the destination. */
  facts?: { label: string; value: ReactNode }[]
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* shadcn's DialogContent is a grid with an implicit `auto` column, which
          sizes to the max-content width of its widest child. One long
          unbreakable branch name therefore pushed the facts and the buttons
          clean outside the box. Pinning the column to minmax(0,1fr) makes the
          children obey the dialog's width so `truncate` can do its job. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[480px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">{body}</div>
        </DialogDescription>

        {facts && facts.length > 0 && (
          <dl className="bg-muted/60 mt-4 space-y-1.5 rounded-xl p-3">
            {facts.map((f) => (
              <div key={f.label} className="flex min-w-0 items-baseline gap-3 text-[12px]">
                <dt className="text-muted-foreground w-[74px] shrink-0">{f.label}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono" title={String(f.value ?? "")}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "outline" : "default"}
            disabled={busy}
            onClick={onConfirm}
            className={cn(destructive && "border-berry/50 text-berry hover:bg-berry/10")}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
