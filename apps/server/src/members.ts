import {
  can,
  event,
  normalEmail,
  type ActorId,
  type KandyEvent,
  type Member,
  type Role,
  type Scope,
} from "@kandy/core"
import type { Engine } from "./engine.js"
import type { Person } from "./identity.js"

/**
 * The people on a hub, folded from the log.
 *
 * One hub is one team. Boards do not have members of their own: a tailnet is
 * already scoped to a company, and per-board grants are the kind of schema
 * built around imagined requirements that `docs/11` warns against. If a buyer
 * asks for them, they are a scope with a board id in it.
 *
 * ## The first person in owns it
 *
 * A hub starts with nobody. The first person Tailscale says has arrived
 * becomes its owner, recorded as a `member.added` they are the actor of.
 * That is the same trust a fresh Grafana or Gitea extends to whoever opens it
 * first — and on a tailnet, "whoever can reach it first" is already someone
 * the company let onto its network.
 *
 * Everyone after that is admitted by an owner, by email. Someone the tailnet
 * lets through but no owner has admitted is told who they are and who to
 * ask, rather than shown an empty board.
 */
export class Members {
  private members = new Map<string, Member>()
  /** People an owner took off, so being refused can say so rather than "ask to be added". */
  private removed = new Set<string>()

  constructor(private readonly engine: Engine) {
    for (let after = 0; ; ) {
      const page = engine.store.since(after, 10_000)
      for (const e of page) this.apply(e)
      if (page.length < 10_000) break
      after = page.at(-1)!.seq
    }
    engine.bus.subscribe((f) => {
      if (!("kind" in f)) this.apply(f)
    })
  }

  private apply(e: KandyEvent): void {
    switch (e.type) {
      case "member.added":
        this.removed.delete(normalEmail(e.data.email))
        this.members.set(normalEmail(e.data.email), {
          email: normalEmail(e.data.email),
          role: e.data.role,
          addedAt: e.ts,
          addedBy: e.actor,
        })
        break
      case "member.role": {
        const m = this.members.get(normalEmail(e.data.email))
        if (m) m.role = e.data.role
        break
      }
      case "member.removed":
        this.members.delete(normalEmail(e.data.email))
        this.removed.add(normalEmail(e.data.email))
        break
    }
  }

  list(): Member[] {
    return [...this.members.values()].sort((a, b) => a.addedAt - b.addedAt)
  }

  roleOf(email: string | null): Role | null {
    if (email === null) return null
    return this.members.get(normalEmail(email))?.role ?? null
  }

  /** Whether an owner took this person off the hub — as against nobody having added them yet. */
  wasRemoved(email: string | null): boolean {
    return email !== null && this.removed.has(normalEmail(email))
  }

  /** Whether nobody owns this hub yet, so the next person to claim it will. */
  unclaimed(): boolean {
    return this.members.size === 0
  }

  /**
   * Who this person is on this hub, admitting them if they are the first.
   *
   * Returns their role, or null for someone who is on the tailnet but not
   * on the team.
   *
   * Only for a person arriving on purpose — opening the board, `kandy join`.
   * Whatever else reaches the hub first (a health check, a runner, a script)
   * must not walk off with it; the HTTP layer decides which requests those
   * are and uses `roleOf` for the rest.
   */
  arrive(person: Person): Role | null {
    const known = this.roleOf(person.email)
    if (known) return known
    if (this.members.size === 0) {
      this.engine.emit(event("member.added", { email: normalEmail(person.email), role: "owner" }), person.email)
      return "owner"
    }
    return null
  }

  allows(email: string | null, scope: Scope): boolean {
    return can(this.roleOf(email), scope)
  }

  /**
   * Admit, change or remove someone. Only an owner may, and a hub is never
   * left without one: the last owner cannot demote or remove themselves,
   * because a hub nobody can administer can only be fixed by editing its
   * database by hand.
   */
  set(by: ActorId, email: string, role: Role | null): void {
    if (!this.allows(by, "member:admin")) throw status(403, "only an owner can change who is on this hub")
    const target = normalEmail(email)
    if (!/^[^\s@]+@[^\s@]+$/.test(target)) throw status(400, "that is not an email address")

    const current = this.roleOf(target)
    const owners = this.list().filter((m) => m.role === "owner")
    if (current === "owner" && role !== "owner" && owners.length === 1) {
      throw status(409, "a hub needs at least one owner — make someone else an owner first")
    }

    if (role === null) {
      if (current) this.engine.emit(event("member.removed", { email: target }), by)
    } else if (current === null) {
      this.engine.emit(event("member.added", { email: target, role }), by)
    } else if (current !== role) {
      this.engine.emit(event("member.role", { email: target, role }), by)
    }
  }
}

function status(code: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: code })
}
