import { createContext, useContext, useState } from "react"
import type { Note, Role, RunnerInfo } from "@kandy/core"
import { can, normalEmail } from "@kandy/core"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui"
import { agentLabel } from "@/features/agents/AgentMark"
import { cn } from "@/lib/utils"

/** Who this browser is, as the daemon sees it. */
export type Me = { hub: boolean; email: string | null; role: Role | null }

/**
 * What `kandy serve` answers, and what we assume until `me()` says otherwise.
 *
 * Assuming single-player is the safe default in both directions: on a plain
 * daemon it is simply true, and on a hub it hides team affordances for the
 * one round-trip it takes to learn otherwise — rather than flashing them at
 * someone who has none.
 */
export const SOLO: Me = { hub: false, email: null, role: null }

export type Team = {
  me: Me
  /** Every machine the hub knows. Empty off a hub. */
  runners: RunnerInfo[]
  /** True for a viewer on a hub. Never true on `kandy serve`, which has no roles. */
  readOnly: boolean
  consent: (noteId: string, accept: boolean, always?: boolean) => Promise<void>
  /** Give a note to a machine. If it was worked on elsewhere, that machine pushes the branch first. */
  assign: (noteId: string, runnerId: string) => Promise<void>
}

const TeamContext = createContext<Team>({
  me: SOLO,
  runners: [],
  readOnly: false,
  consent: async () => {},
  assign: async () => {},
})

/*
 * A context rather than props because the two places that need it — a note's
 * row and its detail pane — sit under the list and the resizable panes, and
 * threading "who am I and which machines exist" through every layer between
 * would touch components that have no business knowing either.
 */
export const TeamProvider = TeamContext.Provider

export function useTeam(): Team {
  return useContext(TeamContext)
}

/**
 * Whether this viewer may change the board.
 *
 * Only someone the hub has *identified* as a viewer is read-only. A hub with
 * no identity — one person holding its token — reports no email and no role,
 * and the server lets that person write; reading "no role" as "viewer" locked
 * them out of their own board.
 */
export function readOnlyFor(me: Me): boolean {
  return me.hub && me.email !== null && !can(me.role, "board:write")
}

/** The tooltip every disabled write control shares, so it reads as one rule. */
export const VIEWER_HINT = "Viewers can look but not change anything."

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normalEmail(a) === normalEmail(b)
}

/**
 * The part of an email a teammate would call you by.
 *
 * Everyone on one hub usually shares a domain, so the half after the @ is the
 * same on every line and says nothing — the full address stays in a title.
 */
export function person(email: string | null | undefined): string {
  if (!email) return "someone"
  return email.split("@")[0] || email
}

/** Two letters for an avatar, from the name part of an email. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s._+-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/**
 * How long ago, in words.
 *
 * `relTime` stops at hours because a running note never gets past them; a
 * member added last month would read as "720h".
 */
export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  const d = Math.round(s / 86_400)
  return d < 60 ? `${d}d ago` : new Date(ts).toLocaleDateString()
}

export function runnerById(runners: RunnerInfo[], id: string | null | undefined) {
  return id ? runners.find((r) => r.runnerId === id) : undefined
}

/**
 * Which machine this note lives on. Hub only, and only once it is placed —
 * off a hub every note lives on the one machine there is, and saying so on
 * every row would be noise.
 */
export function RunnerChip({ note, className }: { note: Note; className?: string }) {
  const { me, runners } = useTeam()
  if (!me.hub || !note.runner) return null
  const r = runnerById(runners, note.runner)
  // A runner we have not heard of yet still gets a chip; the name arrives
  // with the next poll.
  const name = r?.name ?? note.runner.slice(0, 8)
  return (
    <span
      title={r?.owner ? `${r.name} — ${r.owner}'s machine` : undefined}
      className={cn(
        "border-hairline text-muted-foreground inline-flex max-w-[180px] items-center gap-1 truncate rounded-full border px-1.5 py-px text-micro",
        className,
      )}
    >
      on {name}
    </span>
  )
}

/**
 * Someone asked to run this note on a machine whose owner has not said yes.
 *
 * Nothing is running, and nothing will until the owner answers — which is why
 * it wears the attention colour: a held note is the one state on a hub that
 * looks idle but is actually waiting on a person. To the owner it is a
 * question with three answers; to everyone else it says whose move it is.
 */
export function HeldCallout({ note, compact, className }: { note: Note; compact?: boolean; className?: string }) {
  const { me, runners, consent } = useTeam()
  const [busy, setBusy] = useState(false)
  if (!me.hub || !note.held) return null

  const held = note.held
  const runner = runnerById(runners, held.runnerId)
  const mine = sameEmail(runner?.owner, me.email)
  const asker = person(held.requestedBy)

  async function answer(accept: boolean, always?: boolean) {
    setBusy(true)
    try {
      await consent(note.id, accept, always)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "bg-lemon-bg/60 border-lemon/25 rounded-lg border",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        className,
      )}
    >
      <p className={cn("leading-relaxed", compact ? "text-meta" : "text-aux")}>
        {mine ? (
          <>
            <span className="text-lemon font-medium" title={held.requestedBy ?? undefined}>
              {asker}
            </span>
            <span className="text-muted-foreground">
              {" "}wants to run this on your machine with {agentLabel(held.agent)}.
            </span>
          </>
        ) : (
          <>
            <span className="text-lemon font-medium">Waiting</span>
            <span className="text-muted-foreground">
              {" "}for {runner?.owner ? person(runner.owner) : "the machine's owner"} to allow it on
              their machine.
            </span>
          </>
        )}
      </p>
      {mine && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="xs" disabled={busy} onClick={() => void answer(true)}>
            Run it
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void answer(true, true)}>
            Always allow {asker}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => void answer(false)}
            className="text-muted-foreground hover:text-berry"
          >
            Decline
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Give this note to someone's machine.
 *
 * The one control the whole hub exists for. Lists the connected machines that
 * have this repository checked out, named by whose they are — a person
 * decides to hand work to Bob, not to `rnr_m39z…`. If the note was already
 * worked on, the machine that has it pushes the branch and the receiver
 * continues it with a briefing; the hub moves nothing but the record.
 *
 * Handing over does not run it. Whoever it now belongs to runs it, and if
 * someone else asks, their machine's consent rule answers.
 */
export function GiveTo({ note, className }: { note: Note; className?: string }) {
  const { me, runners, readOnly, assign } = useTeam()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!me.hub || readOnly) return null
  if (note.status === "running" || note.status === "queued") return null

  const able = runners.filter((r) => r.online && r.boards.includes(note.boardId) && r.runnerId !== note.runner)
  if (able.length === 0) return null

  async function give(runnerId: string) {
    setBusy(true)
    setError(null)
    try {
      await assign(note.id, runnerId)
    } catch (err) {
      // The server's words: "that machine does not have this repository" is
      // only something it can know.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" disabled={busy}>
            {busy ? "Handing over…" : "Give to…"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <DropdownMenuLabel className="text-meta text-muted-foreground">
            {note.branch ? "Continues on their machine, from this branch" : "Runs on their machine"}
          </DropdownMenuLabel>
          {able.map((r) => (
            <DropdownMenuItem key={r.runnerId} onSelect={() => void give(r.runnerId)}>
              <span className="min-w-0 flex-1 truncate">
                {r.owner ? (sameEmail(r.owner, me.email) ? "Me" : person(r.owner)) : r.name}
              </span>
              <span className="text-muted-foreground truncate text-meta">{r.owner ? r.name : r.os}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-berry text-meta">{error}</span>}
    </span>
  )
}
