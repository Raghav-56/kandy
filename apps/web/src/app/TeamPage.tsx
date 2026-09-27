import { useEffect, useMemo, useRef, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { BoardView, KandyEvent, Role, RunnerInfo } from "@kandy/core"
import { activityActor, activityContext, activityPhrase, can, isTeamActivity, ROLES } from "@kandy/core"
import {
  Button,
  CopyButton,
  CopyCommand,
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
import { inviteMessage, joinCommand } from "@/features/team/install"
import { InviteCard, SetupHub, useHubSetup, useMembers, type Roster } from "@/features/team/onboarding"
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
  boardCount,
  focusAdd,
  onFocusedAdd,
  onAddBoard,
  onRunners,
}: {
  client: KandyClient
  view: BoardView | null
  me: Me
  runners: RunnerInfo[]
  /** Attributed events, newest first, from the board's own stream. */
  recent: KandyEvent[]
  boardCount: number
  /** Set by "Invite your team" elsewhere, to land on the add-person row once. */
  focusAdd: boolean
  onFocusedAdd: () => void
  onAddBoard: () => void
  onRunners: (runners: RunnerInfo[]) => void
}) {
  // Owned here rather than in People so the setup card ticks "Invite your
  // team" the moment someone is added — the stream only says so when a board
  // is open, and a fresh hub may not have one yet.
  const roster = useMembers(client, recent)
  const setup = useHubSetup(me, runners, boardCount, roster.identity ? (roster.members?.length ?? null) : null)
  const addRef = useRef<HTMLInputElement>(null)
  const focusAddRow = () => {
    addRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
    addRef.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!focusAdd) return
    focusAddRow()
    // Handled once, so opening Team later from the sidebar does not grab focus.
    onFocusedAdd()
  }, [focusAdd, onFocusedAdd])

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

      <SetupHub setup={setup} onAddBoard={onAddBoard} onInvite={focusAddRow} className="mt-6" />

      <People client={client} me={me} roster={roster} addRef={addRef} />

      <Section
        title="Machines"
        body="Each person's notes run on their own machine, with their own agents and logins. The hub runs nothing."
      >
        <Machines runners={runners} me={me} />
        <div className="mt-4">
          <p className="text-muted-foreground text-aux">To connect a machine, run this on it:</p>
          <CopyCommand command={joinCommand()} className="mt-1.5" />
        </div>
      </Section>

      <Section title="Activity" body="What people did on this hub, most recent first.">
        <Activity recent={recent} view={view} runners={runners} />
      </Section>
    </div>
  )
}

function People({
  client,
  me,
  roster,
  addRef,
}: {
  client: KandyClient
  me: Me
  roster: Roster
  addRef: React.Ref<HTMLInputElement>
}) {
  const { members, setMembers, identity, error, setError } = roster
  const [busy, setBusy] = useState<string | null>(null)
  /** Who was just added, for the message to send them. */
  const [invited, setInvited] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("member")
  const admin = can(me.role, "member:admin")

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
                    {/* Anyone added may still need telling how to get in —
                        the message is the same for everyone, so any row has it. */}
                    {!self && <CopyButton text={inviteMessage()} label="Copy invite" />}
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
            void set(target, role).then((ok) => {
              if (!ok) return
              setEmail("")
              setInvited(target)
            })
          }}
        >
          <Input
            ref={addRef}
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

      {admin && invited && <InviteCard email={invited} onDone={() => setInvited(null)} />}

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
        No machine has connected yet.
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
  const lines = recent.filter(isTeamActivity).slice(0, ACTIVITY)
  if (lines.length === 0) {
    return <p className="text-muted-foreground text-aux">Nothing yet. What people do here will show up as it happens.</p>
  }

  const ctx = useMemo(() => activityContext(recent, view, runners), [recent, view, runners])

  return (
    <ul className="space-y-2">
      {lines.map((e) => (
        <li key={e.seq} className="flex items-baseline gap-3 text-aux">
          <span className="min-w-0 flex-1 leading-relaxed">
            <span className="font-medium" title={activityActor(e) ?? undefined}>
              {person(activityActor(e))}
            </span>{" "}
            <span className="text-muted-foreground">{activityPhrase(e, ctx)}</span>
          </span>
          <span className="text-faint shrink-0 text-meta tabular-nums">{ago(e.ts)}</span>
        </li>
      ))}
    </ul>
  )
}


