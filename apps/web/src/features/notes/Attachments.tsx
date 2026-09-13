import { useRef, useState, type DragEvent } from "react"
import { Paperclip, X } from "lucide-react"
import { Button } from "@/ui"
import { cn } from "@/lib/utils"

export type Attached = { name: string; data: string; bytes: number }

/** 8MB each. A screenshot is well under; a video is not what this is for. */
const MAX = 8 * 1024 * 1024

async function toBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buf)
  // Chunked, because spreading a large array into String.fromCharCode blows
  // the argument limit on anything bigger than a small image.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Files handed to the agent along with a message.
 *
 * Drop, paste or pick. They are written into the note's worktree, so the agent
 * opens them with the tools it already has rather than us inventing a way to
 * show it an image.
 */
export function Attachments({
  files,
  onChange,
  children,
}: {
  files: Attached[]
  onChange: (files: Attached[]) => void
  children: (props: { onPaste: (e: React.ClipboardEvent) => void }) => React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [tooBig, setTooBig] = useState<string | null>(null)

  async function add(list: FileList | File[]) {
    const next: Attached[] = []
    for (const file of Array.from(list)) {
      if (file.size > MAX) {
        setTooBig(file.name)
        setTimeout(() => setTooBig(null), 4000)
        continue
      }
      next.push({ name: file.name, data: await toBase64(file), bytes: file.size })
    }
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
              className="bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-[11.5px]"
            >
              <Paperclip className="size-3 opacity-60" />
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
        onPaste: (e) => {
          const pasted = Array.from(e.clipboardData.files)
          if (pasted.length) {
            e.preventDefault()
            void add(pasted)
          }
        },
      })}

      {tooBig && (
        <p className="text-berry mt-1.5 text-[11px]">{tooBig} is over 8MB — too big to attach.</p>
      )}

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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => input.current?.click()}
        className="text-muted-foreground mt-1 h-7 px-2"
      >
        <Paperclip className="size-3.5" />
        Attach
      </Button>
    </div>
  )
}
