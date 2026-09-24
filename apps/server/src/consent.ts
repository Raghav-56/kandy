import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { normalEmail } from "@kandy/core"
import { STATE_DIR } from "./paths.js"

/**
 * Who may make code run on this machine.
 *
 * Kept on the runner, in its own state directory, and never on the hub. A
 * hub is somewhere other people administer; a row there that an admin can
 * edit does not make it safe for this laptop. If Bob can assign a note to
 * Alice's runner, Bob can cause an agent to execute on Alice's machine, under
 * her logins, with her keys in her keychain — so the answer to "may he?" has
 * to be hers, held where only she can change it.
 *
 * The runner's owner is always accepted: it is their machine. Everyone else
 * is decided by one setting:
 *
 *   nobody     only I run things here
 *   approved   people I have said yes to; anyone else's note waits for me
 *   team       anyone on the hub
 *
 * `approved` is the default because it is the one that cannot surprise
 * anyone. The first note from a new person arrives as a request with their
 * name on it, and one click answers it for good.
 */

export type Accept = "nobody" | "approved" | "team"

export type Consent = { accept: Accept; approved: string[] }

const DEFAULT: Consent = { accept: "approved", approved: [] }

export class ConsentStore {
  private readonly file: string
  private held: Consent

  constructor(file = path.join(STATE_DIR, "consent.json")) {
    this.file = file
    this.held = this.load()
  }

  private load(): Consent {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Consent>
      const accept: Accept =
        raw.accept === "nobody" || raw.accept === "team" || raw.accept === "approved" ? raw.accept : DEFAULT.accept
      const approved = Array.isArray(raw.approved) ? raw.approved.filter((e) => typeof e === "string").map(normalEmail) : []
      return { accept, approved }
    } catch {
      return { ...DEFAULT, approved: [] }
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.held, null, 2) + "\n", { mode: 0o600 })
  }

  get(): Consent {
    return { accept: this.held.accept, approved: [...this.held.approved] }
  }

  /**
   * Run now, or hold for the owner.
   *
   * `requestedBy` is who the hub says asked. The runner takes the hub's word
   * for identity — the hub is what Tailscale told — but never its word for
   * permission, which is decided here.
   */
  decide(requestedBy: string | null, owner: string | null): "run" | "hold" {
    // A single-player setup has no owner and no one else to ask: every
    // request is the one person at the keyboard.
    if (owner === null || requestedBy === null) return "run"
    if (normalEmail(requestedBy) === normalEmail(owner)) return "run"
    switch (this.held.accept) {
      case "nobody":
        return "hold"
      case "team":
        return "run"
      case "approved":
        return this.held.approved.includes(normalEmail(requestedBy)) ? "run" : "hold"
    }
  }

  setAccept(accept: Accept): void {
    this.held.accept = accept
    this.save()
  }

  approve(email: string): void {
    const e = normalEmail(email)
    if (!this.held.approved.includes(e)) this.held.approved.push(e)
    this.save()
  }

  revoke(email: string): void {
    this.held.approved = this.held.approved.filter((a) => a !== normalEmail(email))
    this.save()
  }
}
