/**
 * Who may do what on a hub.
 *
 * Roles are what people see; scopes are what is checked. t3code learned this
 * the expensive way — it shipped roles, then deleted them in a migration in
 * favour of capability scopes — and the lesson is not that roles are wrong
 * but that enforcement must never ask "is this person an admin?". It asks
 * "may this person do *this*?", and a role is only a named set of answers.
 *
 * ## What is deliberately not here
 *
 * Who may run code on your laptop. That is not a role on the hub, because a
 * row in a table that an admin can edit does not make it safe for your
 * machine. It is a setting on the runner, decided by whoever owns the
 * machine — see `note.held`. Permission to *ask* is central; permission to
 * *execute* lives on the machine that bears the cost.
 *
 * Nor spending: runs happen on each person's own subscription, so nobody can
 * spend anyone else's tokens, and merges are governed by git's own
 * permissions. The two classic reasons for RBAC do not exist here.
 */

export type Role = "owner" | "member" | "viewer"

export const ROLES: readonly Role[] = ["owner", "member", "viewer"]

export type Scope =
  /** See boards, notes, transcripts and diffs. Transcripts carry prompts and sometimes secrets. */
  | "board:read"
  /** Create and edit boards and notes, steer, review. */
  | "board:write"
  /** Ask a runner — anyone's — to run a note. The runner's owner still decides. */
  | "run:assign"
  /** Admit, remove and change the role of people. */
  | "member:admin"

const GRANTS: Record<Role, readonly Scope[]> = {
  viewer: ["board:read"],
  member: ["board:read", "board:write", "run:assign"],
  owner: ["board:read", "board:write", "run:assign", "member:admin"],
}

export function scopesOf(role: Role): readonly Scope[] {
  return GRANTS[role]
}

export function can(role: Role | null, scope: Scope): boolean {
  return role !== null && GRANTS[role].includes(scope)
}

export type Member = { email: string; role: Role; addedAt: number; addedBy: string | null }

/** An email as a key: Tailscale logins are case-insensitive, so the comparison must be too. */
export function normalEmail(email: string): string {
  return email.trim().toLowerCase()
}
