import { useRef, useState } from "react"
import { Textarea } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function InlineEdit({ value, label, placeholder, required = false, rows, onSave }: {
  value: string
  label: string
  placeholder?: string
  required?: boolean
  rows: number
  onSave: (value: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const active = useRef(false)

  async function save() {
    if (!active.current) return
    active.current = false
    const next = required ? draft.trim() : draft
    if (next === value || (required && !next)) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      if (await onSave(next)) setEditing(false)
      else active.current = true
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <Textarea
        autoFocus
        aria-label={label}
        rows={rows}
        value={draft}
        readOnly={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            active.current = false
            setEditing(false)
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save()
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={saving}
      aria-label={label}
      title="Click to edit"
      className={cn("block w-full whitespace-pre-wrap break-words text-left", !value && "text-faint")}
      onClick={() => {
        setDraft(value)
        active.current = true
        setEditing(true)
      }}
    >
      {value || placeholder}
    </button>
  )
}
