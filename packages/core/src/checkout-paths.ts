/**
 * A path inside a note's own checkout, as the reader needs it.
 *
 * Agents report absolute paths — `/Users/me/app/.kandy/worktrees/note_…/src/app.js`
 * — and printed whole, every tool line wraps and the file name is the last
 * thing on it. Inside the note, the checkout is the only place there is, so
 * `src/app.js` says all of it. Display only: the log keeps what the agent said.
 *
 * An absolute path may have spaces in it (`~/repos/with space/app`), and a
 * repo there is as ordinary as any other — so a segment may contain a single
 * space, as long as what follows it does not look like the next word of a
 * command line: another path, a flag, a pipe. That keeps
 * `cat /x/a.js /r/.kandy/worktrees/n1/b.js` from being read as one path.
 * Relative paths stay space-free: a bare `with space/.kandy/…` is ambiguous.
 */
const SEGMENT = String.raw`(?:[^/\s"']| (?=[^\s/"'&|;<>-]))*`
const CHECKOUT = new RegExp(
  String.raw`(?:(?<![^\s"'=(:])~?\/(?:${SEGMENT}\/)*?|(?:[\w.~-]*\/)*)` +
    String.raw`\.kandy\/worktrees\/[^/\s"']+(\/|(?=[\s"']|$))`,
  "g",
)

export function shortenCheckoutPaths(text: string): string {
  return text.replace(CHECKOUT, (_m, slash: string) => (slash ? "" : "."))
}
