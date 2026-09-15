/**
 * Recognising "this agent is not signed in" in what an agent said.
 *
 * Checking a credential file is a guess: Claude Code's local init succeeds on
 * cached credentials, so the certain signal is the run failing to
 * authenticate. T3 Code declines to probe at all for that reason and relies on
 * the runtime 401 — this is kandy doing both, the cheap check up front and the
 * certain one at the point of use.
 *
 * Deliberately narrow. On the board this was written against, one error frame
 * in ten was an auth failure and the rest were a failed `git worktree add`, an
 * unsupported model, and a hook-trust warning. Matching "failed" or "token"
 * would have caught those and told someone to re-login over a git error, which
 * is the same false alarm as trusting a stale credential file.
 */
const SIGNALS: RegExp[] = [
  // Observed from Claude Code, verbatim.
  /refresh token was revoked/i,
  /log ?out and sign in again/i,
  // Claude Code and T3 Code both report this shape when a session dies.
  /oauth session expired/i,
  /access token could not be refreshed/i,
  // Codex and the APIs underneath both agents.
  /\b401\b.*\b(unauthorized|authentication)\b/i,
  /\bauthentication_error\b/i,
  /\b(not|no longer) (logged in|signed in|authenticated)\b/i,
  /please (run )?`?(claude|codex) login`?/i,
  /run `?(claude|codex) login`? to (sign in|authenticate)/i,
]

/**
 * Whether this text is an agent saying it cannot authenticate.
 *
 * False for every other kind of failure, which is the point — a wrong yes
 * sends someone to fix a sign-in that works.
 */
export function isAuthFailure(text: string | null | undefined): boolean {
  if (!text) return false
  return SIGNALS.some((re) => re.test(text))
}

/**
 * A run the daemon killed, rather than one the agent lost.
 *
 * Restarting the daemon marks everything in flight failed, which keeps the
 * board honest — a card claiming work is running when nothing is would be
 * worse. But "failed" reads as the agent's doing, and it is not: the worktree
 * is untouched and the agent's session id was recorded before the process
 * died, so the work resumes exactly where it stopped.
 *
 * The string is shared rather than matched in two places, because a message
 * that drifts on one side turns this back into an ordinary failure.
 */
export const INTERRUPTED = "daemon restarted while this run was in flight"

export function wasInterrupted(run: { error: string | null } | null | undefined): boolean {
  return run?.error === INTERRUPTED
}
