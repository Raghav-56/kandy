import { useEffect, useRef, useState } from "react"
import type { TranscriptFrame } from "@kandy/core"
import { InlineEdit } from "./InlineEdit"
import { cn } from "@/lib/utils"

/**
 * The agent's stream, as rows rather than a wall of log.
 *
 * Tool calls collapse to one line each — a name and its target — because
 * thirty of them scrolling past is texture, not information. What the agent
 * *said* gets room; what it *ran* gets a line; what it was *refused* gets a
 * callout, because that's the part a person has to act on.
 */
export function Transcript({ frames, prompt, onEditPrompt }: {
  frames: TranscriptFrame[]
  prompt: string
  onEditPrompt?: (body: string) => Promise<boolean>
}) {
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    // Only autoscroll when already at the bottom. Yanking someone back down
    // while they're reading is the rudest thing a log can do.
    if (pinned) end.current?.scrollIntoView({ block: "end" })
  }, [frames.length, pinned])

  return (
    <div
      ref={box}
      onScroll={() => {
        const el = box.current
        if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
      }}
      className="flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-5 py-4"
    >
      {(prompt || onEditPrompt) && (
        <div className="rounded-xl border border-line-soft bg-panel-2 px-3.5 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
            Prompt
          </div>
          <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[1.6] text-dim">
            {onEditPrompt ? (
              <InlineEdit
                value={prompt}
                label="Edit prompt"
                placeholder="Add a prompt…"
                rows={4}
                onSave={onEditPrompt}
              />
            ) : prompt}
          </div>
        </div>
      )}

      {frames.length === 0 && (
        <p className="py-6 text-center text-[12px] text-faint">Nothing yet.</p>
      )}

      {frames.map((f) => (
        <Frame key={`${f.runId}-${f.seq}`} frame={f} />
      ))}
      <div ref={end} />
    </div>
  )
}

function Frame({ frame: f }: { frame: TranscriptFrame }) {
  const denied = f.meta === "permission"

  if (denied || f.role === "error") {
    return (
      <div className="rounded-xl border border-[#3d2621] bg-[#1a1211] px-3.5 py-3">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-coral">
          <span className="h-1.5 w-1.5 rounded-full bg-coral" />
          {denied ? "Refused" : "Error"}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-[1.55] text-[#e8b3a8]">
          {f.text}
        </p>
      </div>
    )
  }

  if (f.role === "user") {
    return (
      <div className="rounded-xl border border-[#22304d] bg-[#121826] px-3.5 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-azure">You</div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-[#c7d6f5]">
          {f.text}
        </p>
      </div>
    )
  }

  if (f.role === "tool") {
    return (
      <div className="flex items-baseline gap-2.5 px-1 py-0.5">
        <span className="shrink-0 rounded-md bg-panel-2 px-1.5 py-0.5 text-[10.5px] font-medium text-dim">
          {f.meta ?? "tool"}
        </span>
        <span className="truncate font-mono text-[11.5px] text-faint" title={f.text}>
          {f.text}
        </span>
      </div>
    )
  }

  if (f.role === "system") {
    // A rule with a caption. The caption must be allowed to wrap — several of
    // these are full sentences, and a fixed-width divider row turns them into
    // a horizontal scrollbar across the whole panel.
    return (
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <span className="h-px w-4 shrink-0 bg-line-soft" />
        <span className="min-w-0 text-[11px] leading-relaxed text-faint">{f.text}</span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>
    )
  }

  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words px-1 text-[13px] leading-[1.65] text-ink",
      )}
    >
      {f.text}
    </p>
  )
}
