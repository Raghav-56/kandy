import { useEffect, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { AgentId, AgentInfo, BoardView } from "@kandy/core"
import { Button, Input, Separator } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { ModelSelect } from "@/features/agents/ModelSelect"
import type { Theme } from "@/hooks/useTheme"
import { cn } from "@/lib/utils"

/**
 * Settings that belong to this machine and this repo.
 *
 * Deliberately small: appearance, which model each agent runs, and what "ready
 * to work" means for this repo. Anything an agent already knows how to decide
 * is not a setting.
 */
export function SettingsPage({
  view,
  agents,
  client,
  theme,
  onTheme,
  onSaved,
  onRemoved,
}: {
  view: BoardView | null
  agents: AgentInfo[]
  client: KandyClient
  theme: Theme
  onTheme: (t: Theme) => void
  onSaved: () => void
  onRemoved: () => void
}) {
  const [models, setModels] = useState<Record<string, string>>({})
  const [setup, setSetup] = useState("")
  const [carry, setCarry] = useState("")
  const [saving, setSaving] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!view) return
    setModels((view.board.models ?? {}) as Record<string, string>)
    setSetup(view.board.setup ?? "")
    setCarry((view.board.carry ?? []).join(", "))
  }, [view?.board.id])

  if (!view) {
    return <p className="text-muted-foreground px-6 py-12 text-center text-[12.5px]">No repo selected.</p>
  }

  async function save(what: string, fn: () => Promise<unknown>) {
    setSaving(what)
    try {
      await fn()
      onSaved()
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Settings</h1>
      <p className="text-muted-foreground mt-1 text-[12.5px]">{view.board.name}</p>

      <Section title="Appearance" body="kandy follows your system unless you say otherwise.">
        <div className="flex gap-2">
          {(["system", "light", "dark"] as const).map((t) => (
            <Button
              key={t}
              variant={theme === t ? "default" : "outline"}
              size="sm"
              onClick={() => onTheme(t)}
              className="capitalize"
            >
              {t}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Models"
        body="Which model each agent runs on this repo. Leave blank to use the agent's own default. A note can override this."
      >
        <div className="space-y-2.5">
          {agents
            .filter((a) => a.installed)
            .map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="flex w-[130px] shrink-0 items-center gap-2 text-[12.5px]">
                  <AgentMark agent={a.id} size={13} />
                  {agentLabel(a.id)}
                </span>
                <ModelSelect
                  agent={a.id}
                  value={models[a.id] ?? null}
                  onChange={(v) =>
                    setModels((m) => {
                      const next = { ...m }
                      if (v) next[a.id] = v
                      else delete next[a.id]
                      return next
                    })
                  }
                  className="w-[260px]"
                />
              </div>
            ))}
        </div>
        <Button
          size="sm"
          className="mt-3"
          disabled={saving === "models"}
          onClick={() =>
            void save("models", () =>
              client.setBoardModels(
                view.board.id,
                Object.fromEntries(Object.entries(models).filter(([, v]) => v.trim())),
              ),
            )
          }
        >
          {saving === "models" ? "Saving…" : "Save models"}
        </Button>
      </Section>

      <Section
        title="Workspace"
        body="Every note runs in a fresh git worktree, which has no node_modules, no .env and no build cache. This is how one is made ready."
      >
        <label className="block">
          <span className="label">Setup command</span>
          <Input
            value={setup}
            onChange={(e) => setSetup(e.target.value)}
            placeholder="pnpm install --prefer-offline"
            className="mt-1.5 font-mono text-[12px]"
          />
        </label>
        <label className="mt-3 block">
          <span className="label">Carry in</span>
          <Input
            value={carry}
            onChange={(e) => setCarry(e.target.value)}
            placeholder=".env, .turbo"
            className="mt-1.5 font-mono text-[12px]"
          />
          <span className="text-muted-foreground/70 mt-1.5 block text-[11px]">
            Gitignored paths copied into each worktree by reference — secrets and caches git
            deliberately doesn't track.
          </span>
        </label>
        <Button
          size="sm"
          className="mt-3"
          disabled={saving === "workspace"}
          onClick={() =>
            void save("workspace", () =>
              client.setBoardSetup(
                view.board.id,
                setup.trim() || null,
                carry.split(",").map((s) => s.trim()).filter(Boolean),
              ),
            )
          }
        >
          {saving === "workspace" ? "Saving…" : "Save workspace"}
        </Button>
      </Section>

      <Section title="Repository" body="Where this board's work happens.">
        <p className="bg-muted rounded-lg px-3 py-2 font-mono text-[12px]">{view.board.repoPath}</p>

        <div className="border-berry/25 mt-5 rounded-xl border p-4">
          <p className="text-[12.5px] font-medium">Remove this repo from kandy</p>
          <p className="text-muted-foreground mt-1 max-w-[52ch] text-[12px] leading-relaxed">
            Forgets the board, its notes and any leftover worktrees. The repository itself, and
            anything you already merged, is untouched.
          </p>
          {confirming ? (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-berry/50 text-berry"
                disabled={saving === "remove"}
                onClick={() =>
                  void save("remove", async () => {
                    await client.removeBoard(view.board.id)
                    onRemoved()
                  })
                }
              >
                {saving === "remove" ? "Removing…" : "Yes, remove it"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-berry mt-3"
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  body,
  children,
  className,
}: {
  title: string
  body?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <Separator className="my-7" />
      <section className={cn(className)}>
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {body && (
          <p className="text-muted-foreground mt-1 max-w-[58ch] text-[12.5px] leading-relaxed">
            {body}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </section>
    </>
  )
}
