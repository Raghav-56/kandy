import { useEffect, useState } from "react"
import { Check, X } from "lucide-react"
import type { KandyClient } from "@kandy/client"
import type { KandyEvent, Member, RunnerInfo } from "@kandy/core"
import { can } from "@kandy/core"
import { Button, CopyButton, CopyCommand } from "@/ui"
import { Logo } from "@/brand/Logo"
import { cn } from "@/lib/utils"
import { inviteCommand, inviteMessage, joinCommand } from "./install"
import { myMachineOnline, person, type Me } from "./team"

/*
 * Getting onto a hub, for each of the three people who arrive at one: someone
 * nobody has added yet, a member whose laptop is not connected, and the owner
 * who just started it. All hub-only — `kandy serve` has one person on one
 * machine and none of these questions.
 */

/**
 * Someone the tailnet let through but no owner has added.
 *
 * Shown instead of the whole app, before anything asks for a board: every call
 * past `/me` is refused for them, and a board full of 403s tells a newcomer
 * nothing except that something is broken. This says what is true — you are
 * known, you are not in yet, and exactly who can fix that.
 */
export function NotAdmitted({ me, onCheck }: { me: Me; onCheck: () => Promise<Me> }) {
  const [busy, setBusy] = useState(false)
  const [still, setStill] = useState(false)
  const email = me.email ?? ""

  async function check() {
    setBusy(true)
    try {
      // If they are in now, the app replaces this screen; only "not yet"
      // needs saying here, or the button looks like it did nothing.
      const next = await onCheck()
      setStill(next.hub && !next.admitted)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-background flex min-h-full items-start justify-center overflow-y-auto">
      <div className="w-full max-w-[460px] px-6 pt-[16vh] pb-16">
        <Logo size={36} />
        <h1 className="mt-5 text-display font-semibold tracking-[-0.02em]">
          You're signed in as <span className="break-all">{email}</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-ui leading-relaxed">
          Nobody has added you to this hub yet.{" "}
          {me.owners.length > 0 ? "Ask an owner to add you:" : "Ask whoever runs it to add you."}
        </p>

        {me.owners.length > 0 && (
          <ul className="mt-3 space-y-1">
            {me.owners.map((o) => (
              <li key={o} className="text-ui">
                <a href={`mailto:${o}`} className="hover:text-mint underline-offset-2 hover:underline">
                  {o}
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground mt-6 text-aux">They can add you on the Team page, or run:</p>
        <CopyCommand command={inviteCommand(email)} className="mt-2" />

        <div className="mt-6 flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
            {busy ? "Checking…" : "Check again"}
          </Button>
          {still && !busy && <span className="text-faint text-aux">Not yet.</span>}
        </div>
      </div>
    </div>
  )
}

const BANNER_KEY = "kandy.machine-banner-dismissed"

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(BANNER_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Your notes cannot run, and here is the one command that fixes it.
 *
 * The hub runs nothing, so a member without a connected laptop can write notes
 * all day and watch none of them start — with no hint why. Persistent because
 * it stays true until they act; dismissable for the session because they may
 * be on a phone, or know and not care right now.
 */
export function MachineBanner({ me, runners, loaded }: { me: Me; runners: RunnerInfo[]; loaded: boolean }) {
  const [dismissed, setDismissed] = useState(dismissedThisSession)
  // `loaded` keeps it from flashing at everyone for the one round-trip
  // before the machine list arrives.
  if (!me.hub || !me.email || !me.admitted || !loaded || dismissed) return null
  // A viewer has no notes to run, so nothing is broken for them.
  if (!can(me.role, "board:write")) return null
  if (myMachineOnline(me, runners)) return null

  return (
    <div className="border-hairline bg-lemon-bg/50 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2">
      <p className="text-aux">
        <span className="text-lemon font-medium">Your machine isn't connected,</span>
        <span className="text-muted-foreground"> so your notes can't run. On your laptop:</span>
      </p>
      <CopyCommand command={joinCommand()} className="bg-background/60 max-w-[380px] min-w-[220px] flex-1" />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss for now"
        className="text-muted-foreground ml-auto"
        onClick={() => {
          setDismissed(true)
          try {
            sessionStorage.setItem(BANNER_KEY, "1")
          } catch {
            // Blocked storage just means it comes back on reload.
          }
        }}
      >
        <X />
      </Button>
    </div>
  )
}

/**
 * Who is on this hub, fetched and kept.
 *
 * Refetched when someone changes the list, not polled. Membership is in the
 * log, so the stream already says when it moved — keyed on the newest member
 * event rather than on `recent`, which changes with every note anyone touches.
 */
export function useMembers(client: KandyClient, recent: KandyEvent[], enabled = true) {
  const [members, setMembers] = useState<Member[] | null>(null)
  // A hub started without an identity provider has one person — whoever holds
  // its token — and so no list to show.
  const [identity, setIdentity] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const memberSeq = recent.find((e) => e.type.startsWith("member."))?.seq ?? 0

  useEffect(() => {
    if (!enabled) return
    let live = true
    void client
      .members()
      .then((r) => {
        if (!live) return
        setIdentity(r.identity !== false)
        setMembers(r.members)
      })
      .catch((err: Error) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [client, memberSeq, enabled])

  return { members, setMembers, identity, error, setError }
}

export type Roster = ReturnType<typeof useMembers>

const SETUP_KEY = "kandy.hub-setup-done"

function setupDoneBefore(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === "1"
  } catch {
    return false
  }
}

export type HubSetup = {
  show: boolean
  machine: boolean
  board: boolean
  team: boolean
}

/**
 * Where an owner's new hub stands, read from what is actually there.
 *
 * Each step ticks itself from live data rather than from a click, so the list
 * can never claim something that is not true. Once all three have been true,
 * it is gone for good on this browser — a laptop lid closing later is the
 * banner's business, not a reason to ask the owner to set up again.
 */
export function useHubSetup(
  me: Me,
  runners: RunnerInfo[],
  boardCount: number,
  memberCount: number | null,
): HubSetup {
  const [doneBefore, setDoneBefore] = useState(setupDoneBefore)
  const machine = myMachineOnline(me, runners)
  const board = boardCount > 0
  const team = (memberCount ?? 0) > 1
  const all = machine && board && team

  useEffect(() => {
    if (!all || doneBefore) return
    setDoneBefore(true)
    try {
      localStorage.setItem(SETUP_KEY, "1")
    } catch {
      // Blocked storage: it hides for this visit, which is most of the point.
    }
  }, [all, doneBefore])

  const owner = me.hub && !!me.email && can(me.role, "member:admin")
  // `memberCount === null` is "not loaded yet"; waiting for it keeps the card
  // from appearing with a wrong tick and then correcting itself.
  return { show: owner && memberCount !== null && !all && !doneBefore, machine, board, team }
}

/** The owner's three steps from an empty hub to a working one. */
export function SetupHub({
  setup,
  onAddBoard,
  onInvite,
  className,
}: {
  setup: HubSetup
  onAddBoard?: () => void
  onInvite: () => void
  className?: string
}) {
  if (!setup.show) return null
  return (
    <section className={cn("border-hairline bg-card/60 rounded-2xl border p-4", className)}>
      <h2 className="text-title font-semibold">Set up your hub</h2>
      <p className="text-muted-foreground mt-1 text-aux leading-relaxed">
        The hub keeps the board. Notes run on each person's own machine.
      </p>
      <ol className="mt-4 space-y-4">
        <Step done={setup.machine} n={1} title="Connect your machine">
          <p className="text-muted-foreground text-aux">On your laptop:</p>
          <CopyCommand command={joinCommand()} className="mt-1.5" />
        </Step>
        <Step done={setup.board} n={2} title="Add a board">
          {onAddBoard && (
            <Button size="xs" variant="outline" onClick={onAddBoard}>
              Add a board
            </Button>
          )}
        </Step>
        <Step done={setup.team} n={3} title="Invite your team">
          <Button size="xs" variant="outline" onClick={onInvite}>
            Add people
          </Button>
        </Step>
      </ol>
    </section>
  )
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number
  title: string
  done: boolean
  children?: React.ReactNode
}) {
  return (
    <li>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full text-meta font-medium tabular-nums",
            done ? "bg-mint/15 text-mint" : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="size-3" /> : n}
        </span>
        <span className={cn("text-ui", done && "text-muted-foreground line-through decoration-faint")}>
          {title}
        </span>
      </div>
      {/* A done step has nothing left to do, so its controls go with it. */}
      {!done && children && <div className="mt-2 pl-[30px]">{children}</div>}
    </li>
  )
}

/**
 * What to send someone you just added.
 *
 * Adding a person on the hub lets them in, but they still have to hear about
 * it and connect a laptop — so the owner gets the whole message, ready to
 * paste into whatever chat they already use.
 */
export function InviteCard({ email, onDone }: { email: string; onDone: () => void }) {
  const message = inviteMessage()
  return (
    <div className="border-hairline bg-mint-bg/40 mt-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-aux">
          <span className="text-mint font-medium">Added {person(email)}.</span>
          <span className="text-muted-foreground"> Send them this:</span>
        </p>
        <CopyButton text={message} />
        <Button variant="ghost" size="icon-xs" aria-label="Close" className="text-muted-foreground" onClick={onDone}>
          <X />
        </Button>
      </div>
      <pre className="bg-background/60 border-hairline mt-2 overflow-x-auto rounded-md border px-3 py-2 font-mono text-meta leading-relaxed whitespace-pre-wrap">
        {message}
      </pre>
    </div>
  )
}
