/**
 * A path inside a note's own checkout, as the reader needs it.
 *
 * Agents report absolute paths — `/Users/me/app/.kandy/worktrees/note_…/src/app.js`
 * — and printed whole, every tool line wraps and the file name is the last
 * thing on it. Inside the note, the checkout is the only place there is, so
 * `src/app.js` says all of it. Display only: the log keeps what the agent said.
 */
const CHECKOUT = /(?:[\w.~-]*\/)*\.kandy\/worktrees\/[^/\s"']+(\/|(?=[\s"']|$))/g

export function shortenCheckoutPaths(text: string): string {
  return text.replace(CHECKOUT, (_m, slash: string) => (slash ? "" : "."))
}
