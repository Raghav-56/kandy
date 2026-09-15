import { useRef, useState, type DragEvent } from "react"
import { Paperclip, X } from "lucide-react"
import { refuseAttachment } from "@kandy/core"
import { Button } from "@/ui"
import { cn } from "@/lib/utils"

export type Attached = {
  name: string
  data: string
  bytes: number
  /** MIME type, when the browser gave us one worth drawing a thumbnail from. */
  type: string
}

function encode(bytes: Uint8Array): string {
  let binary = ""
  // Chunked, because spreading a large array into String.fromCharCode blows
  // the argument limit on anything bigger than a small image.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** A data URL for the chip, or null for anything that isn't a picture. */
export function thumbnail(f: Attached): string | null {
  return f.type.startsWith("image/") ? `data:${f.type};base64,${f.data}` : null
}

/**
 * Files handed to the agent along with a message.
 *
 * Drop, paste or pick. They end up in the note's worktree, so the agent opens
 * them with the tools it already has rather than us inventing a way to show it
 * an image — and for a note that has not run yet, the daemon holds them until
 * there is a worktree to put them in.
 */
export function Attachments({
  files,
  onChange,
  children,
  bare,
}: {
  files: Attached[]
  onChange: (files: Attached[]) => void
  children: (props: {
    onPaste: (e: React.ClipboardEvent) => void
    /** Open the file picker, for callers that place their own control. */
    open: () => void
  }) => React.ReactNode
  /** Hide the built-in Attach button; the caller renders its own. */
  bare?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [refused, setRefused] = useState<string[]>([])

  async function add(list: FileList | File[]) {
    const next: Attached[] = []
    const no: string[] = []
    for (const file of Array.from(list)) {
      // Decided from the bytes by the same rule the daemon applies, so a file
      // the UI takes is never thrown away later — and one it won't take says
      // so here, while the person is still looking at it.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const reason = refuseAttachment(file.name, bytes)
      if (reason) {
        no.push(reason)
        continue
      }
      next.push({ name: file.name, data: encode(bytes), bytes: file.size, type: file.type })
    }
    setRefused(no)
    if (no.length) setTimeout(() => setRefused([]), 6000)
    if (next.length) onChange([...files, ...next])
  }

  return (
    <div
      onDragOver={(e: DragEvent) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        setOver(false)
        if (e.dataTransfer.files.length) void add(e.dataTransfer.files)
      }}
      className={cn("rounded-xl transition-colors", over && "ring-grape ring-2")}
    >
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={f.name + i}
              className="bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-meta"
            >
              {thumbnail(f) ? (
                <img
                  src={thumbnail(f)!}
                  alt=""
                  className="border-border/60 size-5 shrink-0 rounded-sm border object-cover"
                />
              ) : (
                <Paperclip className="size-3 opacity-60" />
              )}
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-muted-foreground/70 tabular-nums">
                {Math.ceil(f.bytes / 1024)}KB
              </span>
              <button
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="hover:bg-background rounded p-0.5"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {children({
        open: () => input.current?.click(),
        onPaste: (e) => {
          const pasted = Array.from(e.clipboardData.files)
          if (pasted.length) {
            e.preventDefault()
            void add(pasted)
          }
        },
      })}

      {refused.map((reason) => (
        <p key={reason} className="text-berry mt-1.5 text-meta">
          {reason}
        </p>
      ))}

      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void add(e.target.files)
          e.target.value = ""
        }}
      />
      {!bare && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => input.current?.click()}
          className="text-muted-foreground mt-1 h-7 px-2"
        >
          <Paperclip className="size-3.5" />
          Attach
        </Button>
      )}
    </div>
  )
}
