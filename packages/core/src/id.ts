const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

/**
 * Sortable id: 8 chars of base32 timestamp + 8 random. Lexicographic order
 * matches creation order, which makes them useful as tiebreakers and keeps
 * SQLite indexes append-friendly.
 */
export function id(prefix: string): string {
  let ts = Date.now()
  let time = ""
  for (let i = 0; i < 8; i++) {
    time = ALPHABET[ts % 32]! + time
    ts = Math.floor(ts / 32)
  }
  let rand = ""
  for (let i = 0; i < 8; i++) {
    rand += ALPHABET[Math.floor(Math.random() * 32)]!
  }
  return `${prefix}_${time}${rand}`
}

export type BoardId = string
export type ColumnId = string
export type NoteId = string
export type RunId = string
