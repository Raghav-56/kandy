import { ArrowRight, Check, FolderGit2 } from "lucide-react"
import type { AgentInfo } from "@kandy/core"
import { Button } from "@/ui"
import { Logo } from "@/brand/Logo"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { cn } from "@/lib/utils"

/**
 * What you see the first time, before there is a repo.
 *
 * The old first run was a single "Choose a repo" button, which hid the thing
 * that actually decides whether kandy works at all: whether an agent is on
 * this machine and signed in. Without one, you can add a repo, write a note,
 * press run and watch nothing happen — with no clue why. The daemon already
 * knows; it just never said.
 *
 * So the agents come first and say what they are, and choosing a repo is the
 * step after. Deliberately one screen rather than a wizard: there are two
 * facts to establish and a wizard would be ceremony around them.
 */
export function FirstRun({
  agents,
  onChooseRepo,
}: {
  agents: AgentInfo[]
  onChooseRepo: () => void
}) {
  const usable = agents.filter((a) => a.installed && a.authed)
  const known = agents.filter((a) => a.installed || a.id === "claude" || a.id === "codex")
  const ready = usable.length > 0

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 pt-[12vh] pb-16">
      <div className="flex flex-col items-center text-center">
        <Logo size={44} />
        <h1 className="mt-4 text-[19px] font-semibold tracking-[-0.03em]">
          Run coding agents on your repos
        </h1>
        <p className="text-muted-foreground mt-2 max-w-[44ch] text-[13px] leading-relaxed">
          A note is one job. It runs in its own git worktree, on its own branch, so several can
          work at once without colliding — and comes back as a diff you review here.
        </p>
      </div>

      <Step
        n={1}
        title="Agents on this machine"
        done={ready}
        note={
          ready
            ? `${usable.length === 1 ? "One agent is" : `${usable.length} agents are`} ready to take work.`
            : "kandy runs the agent CLIs you already have. Install one and sign in, then reload."
        }
      >
        <div className="mt-3 space-y-1.5">
          {known.map((a) => (
            <AgentRow key={a.id} agent={a} />
          ))}
        </div>
      </Step>

      <Step
        n={2}
        title="Point it at a repository"
        done={false}
        note="kandy adopts the repo, and never touches your working tree — every run gets its own checkout."
      >
        <Button className="mt-3 gap-2" onClick={onChooseRepo}>
          <FolderGit2 className="size-3.5" />
          Choose a repo
          <ArrowRight className="size-3.5 opacity-70" />
        </Button>
        {!ready && (
          <p className="text-muted-foreground/70 mt-2 text-[11.5px]">
            You can do this first — notes will wait until an agent is available.
          </p>
        )}
      </Step>
    </div>
  )
}

function Step({
  n,
  title,
  note,
  done,
  children,
}: {
  n: number
  title: string
  note: string
  done: boolean
  children: React.ReactNode
}) {
  return (
    <section className="border-hairline bg-card/60 mt-5 rounded-2xl border p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums",
            done ? "bg-mint/15 text-mint" : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="size-3" /> : n}
        </span>
        <h2 className="text-[13.5px] font-medium">{title}</h2>
      </div>
      <p className="text-muted-foreground mt-1.5 pl-[30px] text-[12px] leading-relaxed">{note}</p>
      <div className="pl-[30px]">{children}</div>
    </section>
  )
}

/** One agent, and the two facts that decide whether it can run anything. */
function AgentRow({ agent: a }: { agent: AgentInfo }) {
  const state = !a.installed
    ? { label: "not installed", tone: "text-muted-foreground/50" }
    : !a.authed
      ? { label: "not signed in", tone: "text-lemon" }
      : { label: "ready", tone: "text-mint" }

  return (
    <div className="flex items-center gap-2.5">
      <AgentMark agent={a.id} size={14} />
      <span className={cn("text-[12.5px]", a.installed ? "" : "text-muted-foreground/50")}>
        {agentLabel(a.id)}
      </span>
      {a.version && (
        <span className="text-muted-foreground/50 truncate font-mono text-[10.5px]">
          {a.version}
        </span>
      )}
      <span className={cn("ml-auto shrink-0 text-[11.5px]", state.tone)}>{state.label}</span>
    </div>
  )
}
