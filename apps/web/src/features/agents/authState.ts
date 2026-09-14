import type { AgentInfo } from "@kandy/core"

/**
 * What an agent's sign-in is actually doing, in words.
 *
 * "Not signed in" and "signed in a month ago and expired" are different
 * problems with different fixes, and kandy used to show both as the same
 * amber "not signed in" — or worse, as "ready", because it only checked that
 * a credential file existed.
 */
export function authState(a: AgentInfo): {
  label: string
  tone: "ready" | "warn" | "off"
  detail: string | null
} {
  if (!a.installed) return { label: "not installed", tone: "off", detail: null }

  /*
   * A run that was actually refused outranks anything a file says.
   *
   * The CLI's own init succeeds on cached credentials, so a credential that
   * looks fine proves nothing — this is the one signal that has been tested
   * against the real thing.
   */
  if (a.authFailedAt !== null) {
    return {
      label: "sign-in rejected",
      tone: "warn",
      detail: `A run was refused ${relDays(a.authFailedAt)}. Run \`${a.id}\` once and sign in again.`,
    }
  }

  if (a.expiresAt !== null && a.expiresAt <= Date.now()) {
    return {
      label: "sign-in expired",
      tone: "warn",
      detail: `Expired ${relDays(a.expiresAt)}. Run \`${a.id}\` once and sign in again.`,
    }
  }

  if (!a.authed) {
    return { label: "not signed in", tone: "warn", detail: `Run \`${a.id}\` once to sign in.` }
  }

  // Worth saying plainly: on a plan there is no per-token bill, which is what
  // makes the figures on Usage notional.
  const plan = a.plan && a.plan !== "api" ? ` · ${a.plan}` : a.plan === "api" ? " · API key" : ""
  return { label: `ready${plan}`, tone: "ready", detail: expiryNote(a.expiresAt) }
}

function expiryNote(at: number | null): string | null {
  if (at === null) return null
  const days = Math.round((at - Date.now()) / 86_400_000)
  return days <= 14 ? `Sign-in expires in ${days} day${days === 1 ? "" : "s"}.` : null
}

function relDays(at: number): string {
  const days = Math.round((Date.now() - at) / 86_400_000)
  if (days <= 0) return "today"
  return days === 1 ? "yesterday" : `${days} days ago`
}
