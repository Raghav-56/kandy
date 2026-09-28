import { useState } from "react"
import type { AgentId, AgentInfo } from "@kandy/core"
import { Button, CopyCommand } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"

/**
 * What to type to sign each agent in.
 *
 * The same commands `kandy` prints in the terminal. Anything not listed signs
 * in by being run once.
 */
const SIGN_IN: Partial<Record<AgentId, string>> = {
  claude: "claude",
  codex: "codex login",
  cursor: "cursor-agent login",
  opencode: "opencode",
}

/** Offered when nothing is installed at all — the agents most people have. */
const SUGGESTED: AgentId[] = ["claude", "codex", "cursor", "opencode"]

/**
 * Nothing on this machine can run a note.
 *
 * Said once, at the top of the board, with the commands that fix it. It used
 * to be "no agent ready" in small grey type in the sidebar's footer, and the
 * first sign most people got was a note that saved and never ran.
 */
export function NoAgentBanner({
  agents,
  onCheck,
}: {
  agents: AgentInfo[]
  onCheck: () => Promise<void>
}) {
  const [checking, setChecking] = useState(false)
  const installed = agents.filter((a) => a.installed)
  const listed = installed.length > 0 ? installed.map((a) => a.id) : SUGGESTED

  return (
    <div
      role="status"
      className="border-hairline bg-lemon-bg/50 shrink-0 border-b px-4 py-3"
    >
      <p className="text-aux leading-relaxed">
        <span className="text-lemon font-medium">No agent is ready to run notes.</span>
        <span className="text-muted-foreground">
          {installed.length > 0
            ? " Sign in to one in a terminal, then check again:"
            : " Install one of these and sign in, then check again:"}
        </span>
      </p>
      <div className="mt-2 grid max-w-[560px] gap-1.5">
        {listed.map((id) => (
          <div key={id} className="flex min-w-0 items-center gap-2">
            <span className="flex w-[92px] shrink-0 items-center gap-1.5 text-meta text-dim">
              <AgentMark agent={id} size={12} />
              <span className="truncate">{agentLabel(id)}</span>
            </span>
            <CopyCommand command={SIGN_IN[id] ?? id} className="bg-background/60 min-w-0 flex-1" />
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-2.5"
        disabled={checking}
        onClick={() => {
          setChecking(true)
          void onCheck().finally(() => setChecking(false))
        }}
      >
        {checking ? "Checking…" : "Check again"}
      </Button>
    </div>
  )
}
