import type { AgentId, DiffStat } from "@kandy/core"

/**
 * The commit messages kandy writes.
 *
 * kandy used to sign its own history with `kandy: merge <branch>`, and a
 * branch name is not a sentence: it is slugified, cut mid-word by the
 * branch-name limit, and prefixed with an id nobody can read. What it was
 * standing in for — a sentence describing the work — already existed. The
 * person who wrote the note wrote it, twice: a title and a body, in their own
 * words, before any agent ran.
 *
 * So nothing here summarises anything. There is no model call, no heuristic,
 * no "describe this diff". Reformatting prose a human already wrote costs
 * nothing, cannot hallucinate, and is more accurate than a generated summary
 * of the same work would be.
 */

/** git's conventional width. Subject and body are both wrapped to it. */
const WIDTH = 72

/** The note a commit came from — the whole input, since the words are its. */
export type CommitNote = {
  id: string
  title: string
  body: string
}

/**
 * What a run turned out to be, for the footer line on a merge commit.
 *
 * Every field is optional because every field is separately unknowable: an
 * agent that crashed has no turn count, a note merged by hand has no agent.
 * Whatever is known gets printed and the rest is left out.
 */
export type CommitFacts = {
  stat?: DiffStat | null
  agent?: AgentId | string | null
  model?: string | null
  turns?: number | null
}

/**
 * Word-wrap one paragraph, leaving anything unbreakable alone.
 *
 * A word longer than the width — a URL, a path, an error string — is emitted
 * on its own long line rather than broken. A URL split across two lines is no
 * longer a URL, and the reader loses more than the margin gains.
 */
function wrapParagraph(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * Wrap prose to `width`, keeping the shape the author gave it.
 *
 * Blank lines stay blank — they are paragraph breaks the author typed, and
 * reflowing them away turns a structured note into a wall. Lines that begin
 * with whitespace or a list marker are left exactly as they are: they are code
 * blocks, indented output, or bullets, and wrapping those corrupts them.
 */
export function wrap(text: string, width = WIDTH): string {
  const out: string[] = []
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      out.push("")
      continue
    }
    if (/^\s/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line)) {
      out.push(line.trimEnd())
      continue
    }
    out.push(...wrapParagraph(line, width))
  }
  return out.join("\n")
}

/**
 * Would git read this paragraph as a trailer block?
 *
 * It matters because git decides that on its own, at read time, from the last
 * paragraph of the message — so a note whose body happens to end with a line
 * like `Co-Authored-By: someone@example.com` would put a real person in
 * `git shortlog` and GitHub's contributor list for work they never saw. That
 * is exactly the lie the attribution code goes out of its way not to tell.
 *
 * git's rule (trailer.c) is stricter than "contains a trailer": every line in
 * the paragraph must be a `Token: value` or a continuation, unless the block
 * holds a git-generated trailer such as Signed-off-by. This mirrors the strict
 * half, which is the half that bites — a paragraph of prose that merely ends
 * with one trailer-shaped line is not a trailer block to git either.
 */
export function looksLikeTrailers(paragraph: string): boolean {
  const lines = paragraph.split("\n").filter((l) => l.trim())
  const trailer = (l: string) => /^[A-Za-z0-9-]+:\s/.test(l)
  // At least one real trailer, or an indented code block at the end of a note
  // would be mistaken for a block of continuation lines.
  if (!lines.some(trailer)) return false
  return lines.every((l) => trailer(l) || /^[ \t]/.test(l))
}

/**
 * A paragraph git cannot mistake for trailers, so the real ones stay separate.
 *
 * Inserted only when the message would otherwise end in a trailer-shaped
 * paragraph. It says what it is doing, because a reader who finds it deserves
 * to know why kandy added a line to their note.
 */
const NOT_TRAILERS = "(the lines above are from the note, not trailers)"

/** "+198 -14 across 6 files · claude (opus) · 3 turns" — whatever is known. */
function footer(facts: CommitFacts): string {
  const parts: string[] = []
  const s = facts.stat
  if (s && (s.files || s.insertions || s.deletions))
    parts.push(`+${s.insertions} -${s.deletions} across ${s.files} ${s.files === 1 ? "file" : "files"}`)
  if (facts.agent) parts.push(facts.model ? `${facts.agent} (${facts.model})` : String(facts.agent))
  if (facts.turns) parts.push(`${facts.turns} ${facts.turns === 1 ? "turn" : "turns"}`)
  return parts.join(" · ")
}

/**
 * The message for a commit kandy makes on a note's behalf.
 *
 *     Guard the daemon port with a token
 *
 *     <the note's body, wrapped>
 *
 *     +198 -14 across 6 files · claude (opus) · 3 turns
 *
 * The subject is the note's title: unslugified, untruncated, with no `kandy:`
 * prefix, because `git log --oneline` is read by people. A title longer than
 * the subject line folds onto the following lines rather than being cut — git
 * takes the first line as the subject either way, and losing the end of
 * someone's sentence to a margin is worse than a long subject.
 *
 * A note with no body gets no body paragraph. An empty paragraph in a commit
 * message is a reader wondering what was meant to be there.
 */
export function composeCommitMessage(note: CommitNote, facts: CommitFacts = {}): string {
  // A note always has a title — it is required to create one. If this is ever
  // reached, something upstream lost it, and that is a bug; the id at least
  // stays greppable against the board while it is being chased.
  const title = note.title.replace(/\s+/g, " ").trim()
  const subject = title ? wrap(title) : `kandy: ${note.id}`

  const paragraphs = [subject]
  const body = wrap(note.body.trim())
  if (body) paragraphs.push(body)
  const line = footer(facts)
  if (line) paragraphs.push(line)

  const message = paragraphs.join("\n\n")

  // Guard the last paragraph of the finished message — which is git's own
  // unit, not one of the pieces above: a note body is free to contain blank
  // lines of its own, and it is the text after the final one that git reads.
  // Never the subject: git does not read the first paragraph as trailers, so a
  // title typed "Fix: the thing" needs no help and gets no extra line.
  const blocks = message.split(/\n[ \t]*\n/)
  if (blocks.length > 1 && looksLikeTrailers(blocks[blocks.length - 1]!))
    return `${message}\n\n${NOT_TRAILERS}`

  return message
}
