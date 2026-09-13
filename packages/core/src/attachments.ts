/**
 * What may be handed to an agent, decided from the bytes.
 *
 * In core rather than in the server because the browser has to give the same
 * answer: a screenshot that is refused should be refused in the composer, at
 * paste time, not silently three steps later. Two copies of this rule would
 * drift, and the drift would show as a file the UI accepted and the daemon
 * threw away.
 *
 * Deliberately decided from content, not from the name or the browser's MIME
 * guess — Chrome reports `.ts` as `video/mp2t`, which would refuse a
 * TypeScript file for being a video.
 */

/** 8MB each. A screenshot is well under; a video is not what this is for. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** Enough for "here are the three screenshots"; not a file transfer service. */
export const MAX_ATTACHMENTS = 10

export type AttachmentKind = "image" | "text" | "binary"

const MAGIC: number[][] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF8
  [0x42, 0x4d], // BMP
]

function starts(bytes: Uint8Array, magic: number[], at = 0): boolean {
  return magic.every((b, i) => bytes[at + i] === b)
}

function isImage(bytes: Uint8Array): boolean {
  if (MAGIC.some((m) => starts(bytes, m))) return true
  // RIFF....WEBP
  return starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)
}

/**
 * Well-formed UTF-8 with no NUL bytes, over the first 8KB.
 *
 * Hand-rolled rather than a TextDecoder round trip so this file stays free of
 * platform globals: it is imported by both the daemon and the browser bundle.
 */
function isText(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192)
  let i = 0
  while (i < end) {
    const b = bytes[i]!
    // A NUL byte is the cheap, reliable tell for "this is not text".
    if (b === 0x00) return false
    if (b < 0x80) {
      i++
      continue
    }
    const follow = b >= 0xf0 && b <= 0xf4 ? 3 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xc2 && b <= 0xdf ? 1 : -1
    if (follow < 0) return false
    // A character cut in half by the 8KB sample boundary is not corruption —
    // unless the file itself ends there, in which case it is.
    if (i + follow >= end) return end < bytes.length
    for (let k = 1; k <= follow; k++) {
      const c = bytes[i + k]!
      if (c < 0x80 || c > 0xbf) return false
    }
    i += follow + 1
  }
  return true
}

export function classifyAttachment(bytes: Uint8Array): AttachmentKind {
  if (isImage(bytes)) return "image"
  if (isText(bytes)) return "text"
  return "binary"
}

/**
 * Null when the file is fine; a sentence saying why not when it isn't.
 *
 * A refusal is a sentence and not a boolean because the user is owed one — an
 * attachment that just fails to appear is indistinguishable from an agent
 * ignoring it.
 */
export function refuseAttachment(name: string, bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return `${name} is empty`
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    const mb = (bytes.byteLength / 1024 / 1024).toFixed(1)
    return `${name} is ${mb}MB — the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`
  }
  if (classifyAttachment(bytes) === "binary")
    return `${name} is neither an image nor text — an agent cannot read it`
  return null
}
