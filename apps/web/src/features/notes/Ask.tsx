import { useEffect, useState } from "react"
import { ruleLabel, type PermissionPrompt } from "@kandy/core"
import { Button, Textarea } from "@/ui"
import { cn } from "@/lib/utils"

export type Answer = {
  decision: "allow" | "deny"
  scope?: "once" | "note"
  comment?: string
}

/**
 * The question, and three real answers to it.
 *
 * The shape a terminal already trains people to expect, because that is the
 * shape they will reach for without reading: allow once, allow this kind of
 * thing and stop asking, or deny *and say what to do instead*. The third is
 * the one that is usually missing and the one that makes this better than a
 * policy toggle — "no, run the tests with pnpm not npm" is an answer, and
 * "deny" on its own is not.
 *
 * The command is shown in full and never truncated. Approving something you
 * can only partly read is not approval.
 */
export function Ask({
  prompt,
  onAnswer,
}: {
  prompt: PermissionPrompt
  onAnswer: (a: Answer) => Promise<void>
}) {
  const [note, setNote] = useState("")
  const [denying, setDenying] = useState(false)
  const [busy, setBusy] = useState(false)

  // A fresh question is a fresh decision: an unsent denial message from the
  // last one must not be sitting in the box under a different command.
  useEffect(() => {
    setNote("")
    setDenying(false)
  }, [prompt.requestId])

  async function answer(a: Answer) {
    if (busy) return
    setBusy(true)
    try {
      await onAnswer(a)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-y border-lemon/30 bg-lemon-bg px-4 py-3">
      <div className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.08em] text-lemon">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lemon" />
        Waiting on you
      </div>

      <p className="mt-2 text-aux text-dim">
        The agent has stopped and is asking to use <b className="text-ink">{prompt.tool}</b>.
      </p>

      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-lemon/10 px-2.5 py-2 font-mono text-meta leading-[1.6] text-lemon">
        {prompt.command}
      </pre>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" disabled={busy} onClick={() => void answer({ decision: "allow", scope: "once" })}>
          Allow once
        </Button>

        {/* Absent, not disabled, when the request cannot be generalised — a
            chained command would widen the rule past what was read. */}
        {prompt.rule && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void answer({ decision: "allow", scope: "note" })}
            title={`Adds ${ruleLabel(prompt.rule)} to this note only`}
          >
            Always allow <span className="ml-1 font-mono text-meta opacity-80">{ruleLabel(prompt.rule)}</span>
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className={cn("text-berry", denying && "border-berry/30 bg-berry-bg")}
          disabled={busy}
          onClick={() => setDenying((d) => !d)}
        >
          Deny…
        </Button>
      </div>

      {denying && (
        <div className="mt-2.5">
          <Textarea
            autoFocus
            rows={2}
            value={note}
            placeholder="What should it do instead? — e.g. run the tests with pnpm, not npm"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                void answer({ decision: "deny", comment: note.trim() })
              e.stopPropagation()
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-berry"
              disabled={busy}
              onClick={() => void answer({ decision: "deny", comment: note.trim() })}
            >
              {note.trim() ? "Deny and tell it this" : "Deny"}
            </Button>
            <span className="text-meta text-faint">
              Sent to the agent as the reason. Without one it is only told no.
            </span>
          </div>
        </div>
      )}

      {prompt.rule === null && (
        <p className="mt-2 text-meta text-faint">
          No "always allow" for this one — it chains several commands, and a rule
          made from it would cover more than you just read.
        </p>
      )}
    </div>
  )
}
