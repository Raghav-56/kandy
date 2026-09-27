import { useEffect, useId, useState } from "react"
import type { KandyClient } from "@kandy/client"
import type { AgentId, AgentInfo, BoardView, Policy } from "@kandy/core"
import { Button, Confirm, Input, Separator, Switch } from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { ModelSelect } from "@/features/agents/ModelSelect"
import { Capabilities } from "@/features/boards/Capabilities"
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
  const [askFull, setAskFull] = useState(false)

  useEffect(() => {
    if (!view) return
    setModels((view.board.models ?? {}) as Record<string, string>)
    setSetup(view.board.setup ?? "")
    setCarry((view.board.carry ?? []).join(", "))
  }, [view?.board.id])

  const attribution = view?.board.attribution ?? { commit: false, pr: false }

  if (!view) {
    return <p className="text-muted-foreground px-6 py-12 text-center text-aux">No repo selected.</p>
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

  // Read straight from the projected board rather than local state: the
  // setting is a single choice, and a stale copy of it is the one thing this
  // section must never show.
  const defaultPolicy: Policy = view.board.defaultPolicy ?? "repo"

  async function setPolicy(p: Policy) {
    await save("policy", () => client.setBoardPolicy(view!.board.id, p))
    setAskFull(false)
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="text-display font-semibold tracking-[-0.02em]">Settings</h1>
      <p className="text-muted-foreground mt-1 text-aux">{view.board.name}</p>

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
                <span className="flex w-[130px] shrink-0 items-center gap-2 text-aux">
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
        title="Agent access"
        body="What a note written on this repo starts as. A note can still be changed on its own, and notes already on the board keep what they have."
      >
        <div className="flex gap-2">
          <Button
            variant={defaultPolicy === "repo" ? "default" : "outline"}
            size="sm"
            disabled={saving === "policy"}
            onClick={() => void setPolicy("repo")}
          >
            Repo only
          </Button>
          <Button
            variant={defaultPolicy === "full" ? "default" : "outline"}
            size="sm"
            disabled={saving === "policy"}
            onClick={() => (defaultPolicy === "full" ? undefined : setAskFull(true))}
            className={cn(defaultPolicy === "full" && "border-lemon/30 bg-lemon-bg text-lemon")}
          >
            Full access
          </Button>
        </div>
        <p className="text-muted-foreground/70 mt-2.5 max-w-[58ch] text-meta leading-relaxed">
          {defaultPolicy === "full" ? (
            <>
              New notes here can run any shell command. That is what lets them build and test what
              they write — and it is also everything else a shell can do.
            </>
          ) : (
            <>
              New notes here can edit files but most shell commands are refused, including{" "}
              <code className="font-mono">pnpm build</code> and{" "}
              <code className="font-mono">pnpm test</code>.
            </>
          )}
        </p>
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
            className="mt-1.5 font-mono text-aux"
          />
        </label>
        <label className="mt-3 block">
          <span className="label">Carry in</span>
          <Input
            value={carry}
            onChange={(e) => setCarry(e.target.value)}
            placeholder=".env, .turbo"
            className="mt-1.5 font-mono text-aux"
          />
          <span className="text-muted-foreground/70 mt-1.5 block text-meta">
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

      <Section
        title="Capabilities"
        body="What agents on this repo can reach beyond its files: skills they can load, and MCP servers they can call."
      >
        <Capabilities view={view} client={client} onSaved={onSaved} />
      </Section>

      <Section
        title="Attribution"
        body="Whether kandy signs the work it produces. Both are off, and stay off unless you turn them on — your history is yours."
      >
        <Toggle
          label="Commit trailers"
          note="Adds Kandy-Note, Kandy-Run, Kandy-Agent and a Co-Authored-By naming the agent. These are permanent: they are in the history for good, they survive rebases, and a repo with commit-lint or a DCO check may reject them."
          checked={attribution.commit}
          disabled={saving === "attribution"}
          onChange={(commit) =>
            void save("attribution", () =>
              client.setBoardAttribution(view.board.id, { ...attribution, commit }),
            )
          }
        />
        <Toggle
          className="mt-4"
          label="Pull request footer"
          note="Adds a line to PR descriptions saying which agent and model wrote the branch. Cosmetic and reversible — anyone can edit it out, and nothing is written to your history."
          checked={attribution.pr}
          disabled={saving === "attribution"}
          onChange={(pr) =>
            void save("attribution", () =>
              client.setBoardAttribution(view.board.id, { ...attribution, pr }),
            )
          }
        />
      </Section>

      <Section title="Repository" body="Where this board's work happens.">
        <p className="bg-muted rounded-lg px-3 py-2 font-mono text-aux">{view.board.repoPath}</p>

        <div className="border-berry/25 mt-5 rounded-xl border p-4">
          <p className="text-aux font-medium">Remove this repo from kandy</p>
          <p className="text-muted-foreground mt-1 max-w-[52ch] text-aux leading-relaxed">
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

      <Confirm
        open={askFull}
        onOpenChange={(v) => !v && setAskFull(false)}
        title="Give new notes full access"
        body={
          <>
            Every note written on this repo from now on will be able to run <b>any shell command</b>
            , with no approval — installs, network calls, anything you could run yourself. Its
            worktree bounds what it can damage <i>inside</i> the repository. It does not bound what
            it can reach outside one: your home directory, your credentials, the network.
            <br />
            <br />
            This applies to this repository only. Notes already on the board keep the policy they
            have, and any single note can still be set either way.
          </>
        }
        facts={[
          { label: "Repo", value: view.board.repoPath },
          { label: "Applies to", value: "notes written from now on" },
        ]}
        confirmLabel="Give full access"
        busy={saving === "policy"}
        onConfirm={() => void setPolicy("full")}
      />
    </div>
  )
}

/**
 * One switch with the sentence that makes it an informed choice.
 *
 * The note text is not decoration. A commit trailer and a PR footer look like
 * the same setting and are not: one is permanent and machine-read, the other
 * is a paragraph someone can delete. Saying so here is the difference between
 * a toggle and a trap.
 */
function Toggle({
  label,
  note,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: string
  note: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  className?: string
}) {
  const id = useId()
  return (
    /*
     * The whole row toggles, not just the switch.
     *
     * The control is 32×18 — well under any comfortable target — and the words
     * beside it, which are the part you actually read and aim at, did nothing
     * when clicked. Labelling them fixes both at once.
     */
    <div className={cn("flex items-start gap-3", className)}>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-aux font-medium">
          {label}
        </label>
        <p className="text-muted-foreground mt-1 max-w-[52ch] text-aux leading-relaxed">
          {note}
        </p>
      </div>
    </div>
  )
}

export function Section({
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
        <h2 className="text-title font-semibold">{title}</h2>
        {body && (
          <p className="text-muted-foreground mt-1 max-w-[58ch] text-aux leading-relaxed">
            {body}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </section>
    </>
  )
}
