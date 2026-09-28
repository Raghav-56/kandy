import { useEffect, useState } from "react"
import type {
  ActivityFrame,
  AgentId,
  AgentInfo,
  BoardView,
  Forge,
  Note,
  PermissionPrompt,
  Policy,
  StagedFile,
  TranscriptFrame,
} from "@kandy/core"
import { canAsk, cannotDecide, wasInterrupted } from "@kandy/core"
import { ArrowLeft, Maximize2, Minimize2, Paperclip, X } from "lucide-react"
import {
  ActivityLine,
  Button,
  Confirm,
  CopyLink,
  GithubMark,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Hint,
  LoadingBlock,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/ui"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import { AgentSelect } from "@/features/agents/AgentSelect"
import { defaultModelLabel, ModelSelect } from "@/features/agents/ModelSelect"
import { DiffView } from "@/features/diff/DiffView"
import { Ask, type Answer } from "@/features/notes/Ask"
import { type Attached } from "@/features/notes/Attachments"
import { PromptBox } from "@/features/notes/PromptBox"
import { InlineEdit } from "@/features/notes/InlineEdit"
import { PrBadge } from "@/features/notes/PrBadge"
import { GiveTo, HeldCallout, RunnerChip, useTeam, VIEWER_HINT } from "@/features/team/team"
import { Markdown } from "@/features/stream/Markdown"
import { changesStand, lookOf } from "@/features/notes/status"
import { Transcript, type RunHistory } from "@/features/stream/Transcript"
import { cn, compact, cost, duration } from "@/lib/utils"
import { useTick } from "@/hooks/useTick"
import { quietFor } from "@/app/NoteRow"

export type NoteDetailProps = {
  note: Note
  view: BoardView
  agents: AgentInfo[]
  /** The current run's frames — what it was refused, for the callout. */
  frames: TranscriptFrame[]
  /** Every run of this note, oldest first, for the stream. */
  history: RunHistory[]
  activity: ActivityFrame | undefined
  forge: Forge | null
  /** Tracked repo paths, for `@` in the reply box. */
  paths: { files: string[]; dirs: string[] }
  /** Questions this note's agent is standing still waiting for. Usually empty. */
  prompts: PermissionPrompt[]
  onClose: () => void
  onRun: (agent?: AgentId) => void
  onCancel: (runId: string) => void
  onAssign: (agent: AgentId) => void
  onPolicy: (policy: Policy) => void
  onModel: (model: string | null) => void
  onEdit: (patch: { title?: string; body?: string }) => Promise<boolean>
  onSteer: (text: string, files?: Attached[]) => Promise<"live" | "queued" | undefined>
  /** Files held for this note until it has a worktree to put them in. */
  loadStaged: () => Promise<StagedFile[]>
  onUnstage: (name: string) => Promise<StagedFile[]>
  onReview: (decision: "merge" | "discard") => void
  /** Answer one waiting question. */
  onAnswer: (prompt: PermissionPrompt, answer: Answer) => Promise<void>
  /** Ask the surrounding pane for more or less room. */
  onWiden?: (wide: boolean) => void
  /** Covering the board rather than beside it: back, not close, and no widen. */
  narrow?: boolean
  /** The daemon is gone; nothing here can start or stop anything until it is back. */
  offline?: boolean
  /** Raise this note to full access and continue it. */
  onEscalate: () => Promise<void>
  /** What the PR would say, so it can be edited before it exists. */
  onPrPreview: () => Promise<{ title: string; body: string } | undefined>
  onOpenPr: (draft: { title: string; body: string }) => Promise<void>
  onDelete: () => void
  loadDiff: () => Promise<
    { diff: string; capturedAt: number | null; baseBranch: string | null } | undefined
  >
}

/**
 * Everything about one note.
 *
 * A pane beside the list by default, because reading a stream while scanning
 * what else is waiting is the normal motion. Full screen puts the stream and
 * the diff side by side, which is the review motion — what the agent said it
 * did, next to what it actually did.
 */
export function NoteDetail(p: NoteDetailProps) {
  const [tab, setTab] = useState<"stream" | "diff">("stream")
  const [diff, setDiff] = useState<{
    text: string
    capturedAt: number | null
    baseBranch: string | null
  } | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<string | null>(null)
  const [pring, setPring] = useState(false)
  const [files, setFiles] = useState<Attached[]>([])
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [full, setFull] = useState(false)
  /* The PR as it stands before anyone has agreed to it. Fetched when the
     dialog opens, because it depends on a transcript the board does not hold. */
  const [pr, setPr] = useState<{ title: string; body: string } | null>(null)
  const [prTab, setPrTab] = useState<"write" | "preview">("write")
  const [ask, setAsk] = useState<null | "merge" | "pr" | "discard" | "delete" | "escalate">(null)
  const [busy, setBusy] = useState(false)

  const run = p.view.runs.find((r) => r.id === p.note.runId)
  const { readOnly } = useTeam()

  /*
   * The daemon stopped this, not the agent.
   *
   * Restarting kandy marks everything in flight failed, which is honest about
   * the board but blames the wrong party — and the recovery is better than the
   * word suggests: the worktree is untouched and the agent's session id was
   * recorded, so running it again continues the same conversation rather than
   * starting over.
   */
  const interrupted = wasInterrupted(run)
  const live = p.note.status === "running" || p.note.status === "blocked"
  const policy = p.note.policy ?? "repo"

  // What this note was actually refused. The transcript already carries it —
  // the adapter writes each denial as a system frame tagged `permission` — so
  // the answer to "why did this stop" is here rather than somewhere the user
  // has to go hunting for it.
  const refused = p.frames.filter((f) => f.meta === "permission")
  // An agent that cannot be asked is a different situation from one that
  // hasn't been asked yet, and the pane should not imply otherwise.
  const askable = canAsk(p.note.agent)
  const canEscalate = refused.length > 0 && policy !== "full" && p.note.status !== "queued"
  const reviewable = p.note.status === "review"
  const look = lookOf(p.note)
  const stands = changesStand(p.note)
  const split = full && Boolean(p.note.branch)
  useTick(live)

  /*
   * What the diff depends on, as one key.
   *
   * The note id alone meant a follow-up run's changes never appeared: the tab
   * kept the diff it had fetched before the run started. A new run, a status
   * change or a different stat all mean the worktree moved.
   */
  const diffKey = [
    p.note.id,
    p.note.runId,
    p.note.status,
    run?.status,
    p.note.stat ? `${p.note.stat.files}/${p.note.stat.insertions}/${p.note.stat.deletions}` : "",
  ].join(":")

  useEffect(() => {
    // Keep whatever we already have on screen while the next one loads:
    // clearing first made the panel blink white on every tab switch.
    let stale = false
    if (tab === "diff" || split) {
      void p.loadDiff().then((d) => {
        if (!stale && d)
          setDiff({ text: d.diff, capturedAt: d.capturedAt, baseBranch: d.baseBranch })
      })
    }
    return () => {
      stale = true
    }
  }, [tab, split, diffKey])

  // A different note's diff must not be shown under this note's title.
  useEffect(() => {
    setDiff(null)
  }, [p.note.id])

  // Staged files live on the daemon, not in this component's state, which is
  // the whole point: they are still here after a reload. Re-read them whenever
  // the note changes or a run starts, since starting one moves them out.
  useEffect(() => {
    let stale = false
    setStaged([])
    void p.loadStaged().then((s) => !stale && setStaged(s))
    return () => {
      stale = true
    }
  }, [p.note.id, p.note.runId])

  useEffect(() => {
    if (reviewable) setTab("diff")
  }, [reviewable])

  useEffect(() => {
    if (ask !== "pr") {
      setPrTab("write")
      return setPr(null)
    }
    let stale = false
    void p.onPrPreview().then((r) => {
      if (!stale && r) setPr(r)
    })
    return () => {
      stale = true
    }
  }, [ask])

  // What each confirmation needs to state about this particular note.
  const base = diff?.baseBranch ?? p.forge?.defaultBranch ?? "the base branch"
  const facts = [
    ...(p.note.branch ? [{ label: "Branch", value: p.note.branch }] : []),
    ...(p.note.stat
      ? [
          {
            label: "Changes",
            value: (
              <>
                <span className="text-mint">+{p.note.stat.insertions}</span>{" "}
                <span className="text-berry">−{p.note.stat.deletions}</span>
                <span className="text-muted-foreground">
                  {" "}
                  in {p.note.stat.files} file{p.note.stat.files === 1 ? "" : "s"}
                </span>
              </>
            ),
          },
        ]
      : []),
    ...(p.note.pr ? [{ label: "Pull request", value: `#${p.note.pr.number}` }] : []),
  ]

  async function confirmAction(action: () => void | Promise<void>) {
    setBusy(true)
    try {
      await action()
      setAsk(null)
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const text = draft.trim()
    if ((!text && files.length === 0) || sending) return
    setSending(true)
    const how = await p.onSteer(text, files)
    setSending(false)
    if (how) {
      setDraft("")
      setFiles([])
      setDelivery(how === "live" ? "sent to the running agent" : "queued as a follow-up")
      setTimeout(() => setDelivery(null), 4000)
    }
  }

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          {p.narrow && (
            <Button
              variant="ghost"
              size="icon"
              onClick={p.onClose}
              aria-label="Back to the board"
              className="-mt-1 -ml-1.5 shrink-0"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={look.tone} pulse={p.note.status === "running"}>
                {look.label}
              </StatusPill>
              {p.note.agent && (
                <span className="flex items-center gap-1.5 text-meta text-dim">
                  <AgentMark agent={p.note.agent} size={12} />
                  {agentLabel(p.note.agent)}
                </span>
              )}
              <RunnerChip note={p.note} />
              <GiveTo note={p.note} />
            </div>

            <h2 className="mt-2.5 text-lede font-medium leading-snug tracking-[-0.015em]">
              <InlineEdit
                key={p.note.id}
                value={p.note.title}
                label="Edit title"
                required
                rows={2}
                onSave={(title) => p.onEdit({ title })}
              />
            </h2>
          </div>

          <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
            <CopyLink
              path={`/b/${p.note.boardId}/n/${p.note.id}`}
              label="Copy link to this note"
            />
            {!p.narrow && (
            <Hint text={full ? "Narrow" : "Widen — stream beside diff"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={full ? "Narrow the note" : "Widen — stream beside diff"}
                aria-pressed={full}
                onClick={() =>
                  setFull((f) => {
                    // The split needs the room to be worth anything, so the
                    // button asks for it. Dragging afterwards still wins.
                    p.onWiden?.(!f)
                    return !f
                  })
                }
              >
                {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </Hint>
            )}
            {!p.narrow && (
              <Button variant="ghost" size="icon" onClick={p.onClose} aria-label="Close">
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {run && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-dim">
            <span className={cn("tabular-nums", live && "text-lemon")}>
              {duration(run.startedAt, run.endedAt)}
            </span>
            {run.model && (
              <>
                <Sep />
                <span className="font-mono text-meta">{run.model}</span>
              </>
            )}
            {run.turns !== null && <><Sep /><span className="tabular-nums">{run.turns} turns</span></>}
            {run.tokens !== null && <><Sep /><span className="tabular-nums">{compact(run.tokens)} tok</span></>}
            {run.costUsd !== null ? (
              <>
                <Sep />
                <Hint
                  text={
                    run.costSource === "estimated"
                      ? `Estimated from ${run.tokens?.toLocaleString() ?? "?"} tokens${run.model ? ` at ${run.model} rates` : ""} — this agent reports no cost.`
                      : "Reported by the agent."
                  }
                >
                  <span className="tabular-nums">{cost(run.costUsd, run.costSource)}</span>
                </Hint>
              </>
            ) : run.tokens !== null ? (
              <>
                <Sep />
                <Hint text={`No price for ${run.model ?? "this model"}, so the cost is unknown.`}>
                  <span className="text-faint">unpriced</span>
                </Hint>
              </>
            ) : null}
          </div>
        )}

        {p.note.branch && (
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="min-w-0 truncate font-mono text-meta text-faint" title={p.note.branch}>
              {p.note.branch}
            </span>
            {p.note.pr && <PrBadge pr={p.note.pr} onDark />}
            {p.note.stat && stands && (
              <span className="ml-auto shrink-0 text-meta tabular-nums">
                <span className="text-mint">+{p.note.stat.insertions}</span>{" "}
                <span className="text-berry">−{p.note.stat.deletions}</span>
              </span>
            )}
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <AgentSelect
            value={p.note.agent}
            agents={p.agents}
            onChange={p.onAssign}
            className="w-[150px]"
          />

          <ModelSelect
            agent={p.note.agent}
            value={p.note.model}
            onChange={p.onModel}
            placeholder={defaultModelLabel(p.view.board.models, p.note.agent)}
            className="w-[190px]"
          />

          <PolicyToggle value={policy} onChange={p.onPolicy} disabled={live} askable={askable} />

          {!live && !reviewable && (
            <Button
              variant="default"
              onClick={() => p.onRun()}
              /* Held means already asked: a second press would only ask the
                 same owner the same question again. */
              disabled={!p.note.agent || readOnly || !!p.note.held || p.offline}
              title={readOnly ? VIEWER_HINT : undefined}
            >
              {interrupted ? "Resume" : p.note.status === "failed" ? "Retry" : "Run"}
            </Button>
          )}
          {live && run && (
            // Offline, Stop would only fail: the run went when the daemon did.
            <Button onClick={() => p.onCancel(run.id)} disabled={p.offline}>
              Stop
            </Button>
          )}
          {/*
            Work leaves through a pull request where there is somewhere to
            open one.

            A local merge is hidden when a forge is available: a merge nobody
            else can see is a commit you have to remember to do something about
            later. But a repo with no GitHub remote — the first thing most
            people try — has nowhere to send a PR, and without this a finished
            note had no way to land at all, only Discard.
          */}
          {reviewable && cannotDecide(p.note, "merge") === null && (
            <>
              {p.note.pr ? (
                <Button size="sm" asChild>
                  <a href={p.note.pr.url} target="_blank" rel="noreferrer">
                    <GithubMark className="size-3.5" />
                    Review on GitHub
                  </a>
                </Button>
              ) : p.forge?.available ? (
                <Button size="sm" onClick={() => setAsk("pr")} disabled={pring}>
                  {pring ? "Opening…" : "Open a PR"}
                </Button>
              ) : p.forge ? (
                <Button size="sm" onClick={() => setAsk("merge")} disabled={busy}>
                  Merge into {base}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="text-berry"
                onClick={() => setAsk("discard")}
              >
                Discard
              </Button>
            </>
          )}
        </div>
      </header>

      <HeldCallout note={p.note} className="mx-4 mb-3" />

      {interrupted && (
        <div className="border-hairline bg-lemon-bg/40 border-y px-4 py-2.5">
          <p className="text-aux leading-relaxed">
            <span className="text-lemon font-medium">Interrupted</span>
            <span className="text-muted-foreground">
              {" — "}kandy restarted while this was running. Nothing was lost: the worktree is
              untouched and the agent's session was saved, so Resume continues where it stopped.
            </span>
          </p>
        </div>
      )}

      {/* Silent, not failed: most runs that go quiet are a rate-limited or
          unreachable model, but a build can be quiet too — so it's said, and
          stopping is offered, never done here. kandy stops it itself only
          after a much longer silence. */}
      {live && run?.quietSince && (
        <div className="border-hairline bg-lemon-bg/40 flex items-center gap-3 border-y px-4 py-2.5">
          <p className="text-aux flex-1 leading-relaxed">
            <span className="text-lemon font-medium">
              No output from {agentLabel(run.agent)} for {quietFor(run.quietSince)}
            </span>
            <span className="text-muted-foreground">
              {" — "}it may be stuck: often a model that's rate-limited or unreachable. Stop it to
              retry or pick another model, or give it longer.
            </span>
          </p>
          <Button size="sm" onClick={() => p.onCancel(run.id)} disabled={readOnly}>
            Stop
          </Button>
        </div>
      )}

      {/* Above everything, including the refusals: a question with someone
          waiting behind it outranks a list of things already refused. */}
      {p.prompts.map((prompt) => (
        <Ask
          key={prompt.requestId}
          prompt={prompt}
          onAnswer={(answer) => p.onAnswer(prompt, answer)}
        />
      ))}

      {canEscalate && (
        <Refused frames={refused} askable={askable} onAsk={() => setAsk("escalate")} />
      )}

      {!split && (
        <div className="flex items-center gap-1 border-y border-hairline px-4 py-1.5">
          <div role="tablist" aria-label="Note view" className="flex items-center gap-1">
          {(["stream", "diff"] as const).map((t) => {
            const files = t === "diff" && stands && p.note.stat ? p.note.stat.files : 0
            return (
            <button
              key={t}
              role="tab"
              id={`note-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="note-tabpanel"
              aria-label={
                files > 0 ? `Diff — ${files} file${files === 1 ? "" : "s"} changed` : undefined
              }
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                // Arrow keys move between tabs, as a tablist is expected to.
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
                const next = t === "stream" ? "diff" : "stream"
                setTab(next)
                document.getElementById(`note-tab-${next}`)?.focus()
              }}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-aux transition-colors",
                tab === t ? "bg-raised text-ink" : "text-dim hover:text-ink",
              )}
            >
              {t === "stream" ? "Stream" : "Diff"}
              {files > 0 && (
                <span className="ml-1.5 text-meta tabular-nums text-faint">{files}</span>
              )}
            </button>
            )
          })}
          </div>
          <button
            onClick={() => setAsk("delete")}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-meta text-faint transition-colors hover:bg-berry-bg hover:text-berry"
          >
            Delete
          </button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="border-t border-hairline px-4 py-2.5">
          <p className="text-faint mb-1.5 text-meta">
            Waiting for a workspace — handed to the agent when this note runs.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {staged.map((f) => (
              <span
                key={f.name}
                className="bg-muted flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-meta"
              >
                <Paperclip className="size-3 opacity-60" />
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {Math.ceil(f.bytes / 1024)}KB
                </span>
                <button
                  onClick={() => void p.onUnstage(f.name).then(setStaged)}
                  aria-label={`Remove ${f.name}`}
                  className="hover:bg-background rounded p-0.5"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div
        id="note-tabpanel"
        role={split ? undefined : "tabpanel"}
        aria-labelledby={split ? undefined : `note-tab-${tab}`}
        className={cn("flex min-h-0 flex-1", split && "border-t border-hairline")}
      >
        {(tab === "stream" || split) && (
          <div className={cn("flex min-w-0 flex-col", split ? "flex-1 border-r border-hairline" : "flex-1")}>
            <Transcript
              key={p.note.id}
              runs={p.history}
              prompt={p.note.body}
              onEditPrompt={(b) => p.onEdit({ body: b })}
            />
          </div>
        )}
        {(tab === "diff" || split) && (
          <div className={cn("flex min-w-0 flex-col", split ? "flex-[1.25]" : "flex-1")}>
            {diff === null ? (
              <LoadingBlock label="Reading the diff" />
            ) : (
              <DiffView diff={diff.text} capturedAt={diff.capturedAt} />
            )}
          </div>
        )}
      </div>

      {live && p.activity && (
        <div className="border-t border-hairline bg-lemon-bg px-4 py-2.5">
          <div className="flex items-baseline gap-2.5">
            <span className="shrink-0 text-meta font-medium uppercase tracking-[0.06em] text-lemon">
              {p.activity.tool}
            </span>
            <span className="truncate font-mono text-meta text-lemon/85" title={p.activity.detail}>
              {p.activity.detail}
            </span>
          </div>
          <ActivityLine className="mt-1.5" />
        </div>
      )}

      <div className="border-t p-3">
        {/* The same box the board composes with — steering a run and writing a
            note are the same act, and used to look like two different ones. */}
        <PromptBox
          value={draft}
          onChange={setDraft}
          onSubmit={() => void send()}
          files={files}
          onFiles={setFiles}
          paths={p.paths}
          busy={sending}
          hint={delivery ?? null}
          blocked={
            p.offline
              ? "kandy isn't running"
              : !live && !p.note.agent
                ? "Choose an agent above to send"
                : null
          }
          placeholder={
            live ? "Steer the agent — paste or drop files too" : "Say what to change, then send"
          }
        />
      </div>
    </div>
  )

  // Never an overlay. Covering the sidebar to read a diff means losing the one
  // thing the app is for — seeing what else is waiting on you. It is a resizable
  // pane rather than two fixed widths: how much room a diff needs is a property
  // of the diff, not something this component can know. The one exception is
  // a window too narrow to share (`narrow`), where a pane beside the list was
  // a strip too thin to read — there it covers the board, with a way back.
  return (
    <aside className="bg-card flex h-full w-full flex-col border-l">
      {body}

      <Dialog open={ask === "pr"} onOpenChange={(v) => !v && setAsk(null)}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[620px]">
          <DialogTitle>Open a pull request</DialogTitle>
          <DialogDescription asChild>
            <div className="text-muted-foreground mt-1.5 text-aux leading-relaxed">
              Pushes this branch to <b>{p.forge?.repo ?? "the remote"}</b> and opens a PR against{" "}
              <b>{p.forge?.defaultBranch ?? base}</b>. This is the first thing kandy does that
              leaves your machine. The note lands here automatically once the PR is merged.
            </div>
          </DialogDescription>

          {pr === null ? (
            <LoadingBlock className="py-10" label="Composing the description" />
          ) : (
            <div className="mt-4 space-y-2">
              <input
                value={pr.title}
                onChange={(e) => setPr({ ...pr, title: e.target.value })}
                aria-label="Pull request title"
                className="border-line bg-bg focus-visible:border-grape/45 w-full rounded-lg border px-3 py-2 text-title font-medium outline-none"
              />

              {/* Write and Preview, because the body is markdown and GitHub is
                  where it lands — reading it as prose before pushing is how you
                  notice a heading that never closed or a list that is one line. */}
              <Tabs value={prTab} onValueChange={(v) => setPrTab(v as "write" | "preview")}>
                <TabsList className="h-8">
                  <TabsTrigger value="write" className="text-aux">
                    Write
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="text-aux">
                    Preview
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="write" className="mt-2">
                  <Textarea
                    value={pr.body}
                    onChange={(e) => setPr({ ...pr, body: e.target.value })}
                    aria-label="Pull request description"
                    rows={13}
                    className="bg-bg h-[42vh] resize-none font-mono text-aux leading-[1.6]"
                  />
                </TabsContent>

                <TabsContent value="preview" className="mt-2">
                  <div className="border-line bg-bg h-[42vh] overflow-y-auto rounded-lg border px-3.5 py-3">
                    {pr.body.trim() ? (
                      <Markdown>{pr.body}</Markdown>
                    ) : (
                      <p className="text-muted-foreground/60 text-aux">Nothing to preview.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAsk(null)} disabled={busy || pring}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!pr || !pr.title.trim() || busy || pring}
              onClick={() =>
                confirmAction(async () => {
                  if (!pr) return
                  setPring(true)
                  await p.onOpenPr(pr)
                  setPring(false)
                })
              }
            >
              {pring ? "Pushing…" : "Push and open PR"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Confirm
        open={ask === "merge"}
        onOpenChange={(v) => !v && setAsk(null)}
        title={`Merge into ${base}`}
        body={
          <>
            Merges this branch into <b>{base}</b> in your repository, on this machine. Nothing is
            pushed. Your checkout must be on <b>{base}</b>, with no merge or rebase under way.
            The branch and its worktree are tidied away afterwards.
          </>
        }
        facts={facts}
        confirmLabel="Merge"
        busy={busy}
        onConfirm={() => confirmAction(() => p.onReview("merge"))}
      />

      <Confirm
        open={ask === "discard"}
        onOpenChange={(v) => !v && setAsk(null)}
        title="Discard this work"
        body={
          <>
            Removes the worktree. The branch
            {p.note.branch ? (
              <>
                {" "}
                <b>{p.note.branch}</b>
              </>
            ) : null}{" "}
            stays on this machine, unpushed, so the work can still be recovered with git. The note
            stays too, so you can run it again.
          </>
        }
        facts={facts}
        confirmLabel="Discard"
        destructive
        busy={busy}
        onConfirm={() => confirmAction(() => p.onReview("discard"))}
      />

      <Confirm
        open={ask === "escalate"}
        onOpenChange={(v) => !v && setAsk(null)}
        title="Give this note full access"
        body={
          <>
            This note's agent will be able to run <b>any shell command</b>, with no approval — the
            build and the tests it was refused, and equally anything else a shell can do. Its
            worktree bounds what it can damage <i>inside</i> this repository. It does not bound what
            it can reach outside one: your home directory, your credentials, the network.
            <br />
            <br />
            It then continues where it left off, in the same worktree, resuming the same session.
            Only this note changes — the repo's default is not touched.
          </>
        }
        facts={[
          { label: "Repo", value: p.view.board.repoPath },
          { label: "Agent", value: p.note.agent ? agentLabel(p.note.agent) : "none assigned" },
          {
            label: "Refused",
            value: `${refused.length} command${refused.length === 1 ? "" : "s"}`,
          },
        ]}
        confirmLabel="Grant full access and continue"
        busy={busy}
        onConfirm={() => confirmAction(p.onEscalate)}
      />

      <Confirm
        open={ask === "delete"}
        onOpenChange={(v) => !v && setAsk(null)}
        title="Delete this note"
        body={
          <>
            Removes the note and its history from the board.
            {p.note.branch ? " Its branch is left in the repository." : ""} This cannot be undone.
          </>
        }
        facts={[{ label: "Note", value: p.note.title }]}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={() => confirmAction(p.onDelete)}
      />
    </aside>
  )
}

function Sep() {
  return <span className="text-muted-foreground/60">·</span>
}

/**
 * What this note was refused, and the one thing you can do about it.
 *
 * Repo-only means the agent can write a test and then be refused the command
 * that runs it — so the run ends having verified nothing. Without this the
 * only evidence is a line buried in the stream, and the only cure was editing
 * the policy and starting over. Here it is the first thing you see, with the
 * exact commands, and one button that answers it.
 */
function Refused({
  frames,
  askable,
  onAsk,
}: {
  frames: TranscriptFrame[]
  /** Whether this agent could have been asked, rather than just refused. */
  askable: boolean
  onAsk: () => void
}) {
  // The last few, newest first: a long run can be refused the same command
  // twenty times, and twenty identical rows say nothing the first three don't.
  const shown = [...frames].reverse().slice(0, 3)
  const more = frames.length - shown.length

  return (
    <div className="border-y border-berry/25 bg-berry-bg px-4 py-3">
      <div className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.08em] text-berry">
        <span className="h-1.5 w-1.5 rounded-full bg-berry" />
        Refused — repo only
      </div>

      <ul className="mt-2 space-y-1">
        {shown.map((f) => (
          <li
            key={`${f.runId}-${f.seq}`}
            className="truncate font-mono text-meta leading-[1.6] text-berry/85"
            title={f.text}
          >
            {f.text}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-1 text-meta text-faint">
          and {more} more — the full list is in the stream
        </p>
      )}

      {/* Codex decides alone and tells us afterwards — there was never a
          moment at which anyone could have been asked. Saying so beats
          leaving the reader to wonder why nothing asked them. */}
      <p className="mt-2 text-meta text-faint">
        {askable
          ? "These were refused before the question could reach you."
          : "This agent runs non-interactively — it cannot ask, so anything outside the repo is refused outright."}
      </p>

      <Button size="sm" variant="outline" className="mt-2.5 text-lemon" onClick={onAsk}>
        Grant full access and continue
      </Button>
    </div>
  )
}

/**
 * The one place we ask the user to accept risk, so it says what the risk is
 * rather than hiding behind a word like "sandbox".
 */
function PolicyToggle({
  value,
  onChange,
  disabled,
  askable,
}: {
  value: Policy
  onChange: (p: Policy) => void
  disabled: boolean
  /** Whether "repo only" means "it will ask" or "it will simply be refused". */
  askable: boolean
}) {
  const full = value === "full"
  return (
    <Hint
      text={
        full
          ? "Full access: this agent can run any command, including outside the repo."
          : askable
            ? "Repo only: it can edit files, and anything else stops and asks you."
            : "Repo only: it can edit files, but most shell commands are refused — this agent cannot ask, so it is refused outright."
      }
    >
      <Button
        variant={full ? "outline" : "ghost"}
        disabled={disabled}
        onClick={() => onChange(full ? "repo" : "full")}
        className={cn(full && "border-lemon/30 bg-lemon-bg text-lemon")}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", full ? "bg-lemon" : "bg-faint")} />
        {full ? "Full access" : "Repo only"}
      </Button>
    </Hint>
  )
}
