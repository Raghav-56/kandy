import { useEffect, useMemo, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { BoardView, KandyEvent, Member, Role, RunnerInfo } from "@kandy/core"
import { can, ROLES } from "@kandy/core"
import {
  Button,
  Dot,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { ago, person, runnerById, sameEmail, type Me } from "@/features/team/team"
import { useTick } from "@/hooks/useTick"
import { cn } from "@/lib/utils"
import { Section } from "./SettingsPage"

/** How often the machines list is refreshed while you are looking at it. */
const RUNNER_POLL_MS = 10_000

/**
 * Who is on this hub, which machines they brought, and what they did.
 *
 * Hub only — the sidebar never offers it to `kandy serve`. The three sections
 * answer the three questions a shared board raises that a solo one never
 * does: who can do what, where will my note actually run, and who touched it.
 */
export function TeamPage({
  client,
  view,
  me,
  runners,
  recent,
  onRunners,
}: {
  client: KandyClient
  view: BoardView | null
  me: Me
  runners: RunnerInfo[]
  /** Attributed events, newest first, from the board's own stream. */
  recent: KandyEvent[]
  onRunners: (runners: RunnerInfo[]) => void
}) {
  /*
   * Runners come and go without writing to the log — a laptop lid closing is
   * not an event anyone appended — so "online" can only be kept honest by
   * asking. Only while this page is open: nothing else here needs it that
   * fresh.
   */
  useEffect(() => {
    let live = true
    const load = () =>
      void client
        .runners()
        .then((r) => live && onRunners(r.runners))
        .catch(() => {})
    load()
    const t = setInterval(load, RUNNER_POLL_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [client, onRunners])

  // "last seen 3m ago" should not freeze at the moment the page opened.
  useTick(true, 30_000)

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="text-display font-semibold tracking-[-0.02em]">Team</h1>
      <p className="text-muted-foreground mt-1 text-aux">
        {me.email}
        {me.role && <span className="text-faint"> · {me.role}</span>}
      </p>

      <People client={client} me={me} recent={recent} />

      <Section
        title="Machines"
        body="Each person's notes run on their own machine, with their own agents and logins. The hub runs nothing."
      >
        <Machines runners={runners} me={me} />
      </Section>

      <Section title="Activity" body="What people did on this hub, most recent first.">
        <Activity recent={recent} view={view} runners={runners} />
      </Section>
    </div>
  )
}

function People({ client, me, recent }: { client: KandyClient; me: Me; recent: KandyEvent[] }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("member")
  const admin = can(me.role, "member:admin")

  /*
   * Refetched when someone else changes the list, not polled. Membership is
   * in the log, so the stream already says when it moved — keyed on the
   * newest member event rather than on `recent`, which changes with every
   * note anyone touches.
   */
  const memberSeq = recent.find((e) => e.type.startsWith("member."))?.seq ?? 0
  // A hub started without an identity provider has one person — whoever holds
  // its token — and so no list to show. Said, rather than shown empty.
  const [identity, setIdentity] = useState(true)
  useEffect(() => {
    void client
      .members()
      .then((r) => {
        setIdentity(r.identity !== false)
        setMembers(r.members)
      })
      .catch((err: Error) => setError(err.message))
  }, [client, memberSeq])

  async function set(target: string, next: Role | null) {
    setBusy(target)
    setError(null)
    try {
      const r = await client.setMember(target, next)
      setMembers(r.members)
      return true
    } catch (err) {
      // The server's words, not ours: "you are the last owner" is a rule it
      // enforces and the only one who can phrase it exactly.
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      title="People"
      body={
        admin
          ? "Everyone who can open this hub. Owners admit people and set what they can do."
          : "Everyone who can open this hub. Only an owner can change this list."
      }
    >
      {!identity ? (
        <p className="text-muted-foreground text-aux max-w-[46ch]">
          This hub has no way to tell people apart — anyone with its token is the same person. Start
          it with <code className="font-mono">kandy hub --tailscale</code> and everyone who opens it is
          known by their Tailscale login.
        </p>
      ) : members === null ? (
        <p className="text-muted-foreground text-aux">{error ?? "Loading…"}</p>
      ) : (
        <ul className="divide-hairline divide-y">
          {members.map((m) => {
            const self = sameEmail(m.email, me.email)
            return (
              <li key={m.email} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui">
                    {m.email}
                    {self && <span className="text-faint"> · you</span>}
                  </p>
                  <p className="text-muted-foreground mt-0.5 truncate text-meta">
                    {m.addedBy ? `added by ${person(m.addedBy)}, ` : "first here, "}
                    {ago(m.addedAt)}
                  </p>
                </div>
                {admin ? (
                  <>
                    <RoleSelect
                      value={m.role}
                      disabled={busy === m.email}
                      onChange={(r) => void set(m.email, r)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === m.email}
                      onClick={() => void set(m.email, null)}
                      className="text-muted-foreground hover:text-berry"
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground shrink-0 text-aux capitalize">{m.role}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {admin && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const target = email.trim()
            if (!target) return
            void set(target, role).then((ok) => ok && setEmail(""))
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            aria-label="Email of the person to add"
            className="h-8 flex-1 text-aux"
          />
          <RoleSelect value={role} onChange={setRole} />
          <Button size="sm" type="submit" disabled={!email.trim() || busy !== null}>
            Add person
          </Button>
        </form>
      )}

      {error && members !== null && <p className="text-berry mt-2.5 text-aux">{error}</p>}
    </Section>
  )
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role
  onChange: (r: Role) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-[110px] shrink-0 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r} className="capitalize">
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Machines({ runners, me }: { runners: RunnerInfo[]; me: Me }) {
  if (runners.length === 0) {
    return (
      <p className="text-muted-foreground text-aux">
        No machine has connected yet. Run <code className="font-mono">kandy runner</code> on yours.
      </p>
    )
  }
  // Online first: the machines you could ask right now are the ones worth
  // reading, and a laptop that left last week can wait at the bottom.
  const sorted = [...runners].sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen)
  return (
    <ul className="divide-hairline divide-y">
      {sorted.map((r) => {
        const ready = r.agents.filter((a) => a.installed && a.authed)
        return (
          <li key={r.runnerId} className="flex items-start gap-3 py-2.5">
            <Dot tone={r.online ? "mint" : "neutral"} className="mt-[7px]" />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2 text-ui">
                <span className="truncate">{r.name}</span>
                <span className="text-faint shrink-0 text-meta">{r.os}</span>
              </p>
              <p className="text-muted-foreground mt-0.5 truncate text-meta">
                {r.owner ? (sameEmail(r.owner, me.email) ? "yours" : r.owner) : "no owner"}
                {" · "}
                {r.online ? "online" : `last seen ${ago(r.lastSeen)}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5">
              {ready.length === 0 ? (
                <span className="text-faint text-meta">no agent ready</span>
              ) : (
                ready.map((a) => (
                  <span
                    key={a.id}
                    className={cn("flex items-center gap-1 text-meta", !r.online && "opacity-50")}
                  >
                    <AgentMark agent={a.id} size={12} />
                    {agentLabel(a.id)}
                  </span>
                ))
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** How many lines of activity to show. */
const ACTIVITY = 30

function Activity({
  recent,
  view,
  runners,
}: {
  recent: KandyEvent[]
  view: BoardView | null
  runners: RunnerInfo[]
}) {
  /*
   * Titles from the board, then from the events themselves — a note that was
   * deleted since is gone from the view, but the event that created it is
   * still in the ring and still knows what it was called.
   */
  const titles = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of [...recent].reverse()) {
      if (e.type === "note.created") m.set(e.data.noteId, e.data.title)
      if (e.type === "note.edited" && e.data.title) m.set(e.data.noteId, e.data.title)
    }
    for (const n of view?.notes ?? []) m.set(n.id, n.title)
    return m
  }, [recent, view])

  const lines = recent.slice(0, ACTIVITY)
  if (lines.length === 0) {
    return <p className="text-muted-foreground text-aux">Nothing yet. What people do here will show up as it happens.</p>
  }

  const ctx: Ctx = {
    title: (id) => `«${titles.get(id) ?? "a note"}»`,
    column: (id) => view?.columns.find((c) => c.id === id)?.name ?? "another column",
    runner: (id) => runnerById(runners, id)?.name ?? "a machine",
    noteOfRun: (runId) => view?.runs.find((r) => r.id === runId)?.noteId ?? null,
  }

  return (
    <ul className="space-y-2">
      {lines.map((e) => (
        <li key={e.seq} className="flex items-baseline gap-3 text-aux">
          <span className="min-w-0 flex-1 leading-relaxed">
            <span className="font-medium" title={e.actor ?? undefined}>
              {person(e.actor)}
            </span>{" "}
            <span className="text-muted-foreground">{phrase(e, ctx)}</span>
          </span>
          <span className="text-faint shrink-0 text-meta tabular-nums">{ago(e.ts)}</span>
        </li>
      ))}
    </ul>
  )
}

type Ctx = {
  title: (noteId: string) => string
  column: (columnId: string) => string
  runner: (runnerId: string) => string
  noteOfRun: (runId: string) => string | null
}

/**
 * One event as the rest of a sentence whose subject is the actor.
 *
 * Only the events people do on purpose are phrased. Anything else falls back
 * to its type — ugly but true, which beats a list that quietly omits what it
 * cannot describe.
 */
function phrase(e: KandyEvent, c: Ctx): string {
  switch (e.type) {
    case "note.created":
      return `wrote ${c.title(e.data.noteId)}`
    case "note.edited":
      return `edited ${c.title(e.data.noteId)}`
    case "note.moved":
      return `moved ${c.title(e.data.noteId)} to ${c.column(e.data.columnId)}`
    case "note.assigned":
      return `gave ${c.title(e.data.noteId)} to ${agentLabel(e.data.agent)}`
    case "note.deleted":
      return `deleted ${c.title(e.data.noteId)}`
    case "note.policy":
      return `set ${c.title(e.data.noteId)} to ${e.data.policy === "full" ? "full access" : "repo only"}`
    case "note.held":
      return `asked to run ${c.title(e.data.noteId)} on ${c.runner(e.data.runnerId)}`
    case "note.released":
      return `${e.data.accepted ? "allowed" : "declined"} ${c.title(e.data.noteId)}`
    case "note.pr":
      return e.data.pr ? `opened a PR for ${c.title(e.data.noteId)}` : `updated the PR for ${c.title(e.data.noteId)}`
    case "run.requested":
      return `ran ${c.title(e.data.noteId)} with ${agentLabel(e.data.agent)}`
    case "run.unblocked": {
      const noteId = c.noteOfRun(e.data.runId)
      const what = e.data.decision === "allow" ? "allowed" : "denied"
      return noteId ? `${what} a request on ${c.title(noteId)}` : `${what} an agent's request`
    }
    case "review.decided": {
      const verb = { merge: "merged", discard: "discarded", revise: "sent back" }[e.data.decision]
      return `${verb} ${c.title(e.data.noteId)}`
    }
    case "member.added":
      return `added ${e.data.email} as ${e.data.role}`
    case "member.role":
      return `made ${e.data.email} ${e.data.role === "owner" ? "an" : "a"} ${e.data.role}`
    case "member.removed":
      return `removed ${e.data.email}`
    case "board.created":
      return `added the repo ${e.data.name}`
    default:
      return e.type
  }
}
