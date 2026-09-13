# Open questions

Honest list. These are unresolved, and some of them are load-bearing.

## Product

**What is a note's output, exactly?** "A branch and a diff" is the current answer. But most
agent work is not one clean commit — it's a branch with five messy commits and a conversation
that explains them. Does review show the diff, the transcript, or a generated summary? Getting
this wrong makes review feel like homework, and review is the whole back half of the product.

**Does a board map to a repo, or can it span repos?** One repo is simpler and matches worktree
isolation cleanly. But real work spans a frontend and a backend, and forcing two boards for one
task is exactly the friction we claim to remove.

**~~Free-position canvas or columns?~~** *Settled: columns.* We built the spatial version — a
3D board with cards in space — and it was worse at the only two questions a board needs to
answer. Free positioning is expressive; a lifecycle is not a thing you want to arrange by hand.
See [`10-interface.md`](10-interface.md).

**Where do rough thoughts live?** A note is a job: it has a lifecycle and it runs. There is
no home for the other kind of artifact — a strategy memo, a half-formed idea, a spec you want
three future notes to be given as context. `11-going-multiplayer.md` is the proof of the gap:
a conversation that had to be flattened into a repo file to survive, where the next agent has
to be *told* the file exists. Open whether that is a note type, a board-level drawer, or a
first-class context library that notes reference. Steering-chat attachments already do a narrow
version of it.

**Who is this for?** Someone running six agents at once is already sophisticated and probably
already has tmux and a script. The person who *needs* a board may not yet run enough agents to
need one. This gap is real and unresolved.

## Technical

**~~How does a blocked run actually surface, and can we answer it?~~** *Answered, and this
section was wrong until we checked.* It claimed that answering a prompt in flight required the
`canUseTool` callback from `@anthropic-ai/claude-agent-sdk`, and therefore running the agent
in-process instead of as a subprocess — "a real architectural fork, not a tweak". That was
simply not true of the CLI we already spawn.

`claude --permission-prompt-tool <mcp tool name>` routes a permission prompt to a tool *we*
provide instead of auto-denying it. It is a real flag — unknown flags are rejected outright, and
this one runs clean against the installed CLI. `claude --permission-prompts host|none` decides
whether anything is asked at all, and defaults to `host`. So kandy runs a small MCP server
(`apps/server/src/permission-mcp.ts`, a dependency-free stdio sidecar the agent spawns itself),
points the agent at it for the life of one run, and the prompt arrives as an ordinary tool call.
The daemon holds that call open, puts the question on the board, and returns allow or deny when
someone answers. No in-process SDK, no rewrite.

The decision itself is opencode's shape, as `docs/06-landscape.md` said it would be: permission
rules are a **pure function** from (tool, args, rules) to `allow | deny | ask`, in
`packages/core/src/permission.ts`, testable without a socket; and a deferred in
`apps/server/src/permission.ts` blocks the tool call until a client answers, because the agent
genuinely waits.

The options are the three a terminal already trains people to expect — allow once; allow this
kind of thing for this note and stop asking; deny **with a message saying what to do instead**.
The third is the one people forget to build and the reason this beats a policy toggle: "no, run
the tests with pnpm not npm" is an answer, and "deny" alone is not.

Four things follow from that, each a decision rather than an accident:

- A waiting prompt is the most urgent thing on a board — above `blocked`, which only ever meant
  "was refused and carried on". It sits above *Needs you*, names the tool, shows the exact
  command verbatim, and is answerable from the note detail pane.
- It **times out** rather than hanging forever, and the transcript says so when it does. An
  agent blocked on a question nobody answers is worse than one that was denied: it holds a slot
  and looks like work in flight.
- "Don't ask again" is scoped **per note, not per board**. A board-wide rule is a bigger
  decision than someone makes while unblocking one run — `defaultPolicy` is where that lives.
  A rule is also never generalised across a shell operator, so approving `pnpm test` cannot
  quietly approve `pnpm test && rm -rf ~`.
- It is **Claude only**. Codex's non-interactive exec has no equivalent, so `ASK_CAPABLE` in
  core names the agents that can be asked and every surface reads it. A codex note says plainly
  that its agent cannot ask, rather than showing an affordance that silently does nothing.

Escalate-to-full-access stays. It is the blunt instrument — it changes the note's policy and
resumes the agent in the same worktree, after the fact, for the whole note — and it is still
sometimes the right one.

**Can we reliably capture agent session ids?** Resume — which steering depends on — needs them.
Claude emits `session_id` on every event and can even be handed one up front, so it is solved
there. Codex won't let us pre-assign one; Gemini doesn't reliably emit one at all. Steering will
therefore be excellent on some agents and degraded on others, which is a bad inconsistency to
put in front of a user without explaining it.

And even where we capture one, **it is machine-local** — a Claude session on my laptop is not
resumable on yours, and Codex's thread lives in my `~/.codex`. That caps what sharing can
honestly promise: a teammate gets a fresh run seeded with the replayed transcript, not a
resumed session. "Hand off the thread", not "resume the session". See
[`11-going-multiplayer.md`](11-going-multiplayer.md).

**How much output is too much?** An agent can emit megabytes. Storage, replay, and rendering
all need a cap or a rollup, and we haven't designed one.

**Does the in-process-worker trick survive our shape?** It's clean for opencode where the TUI
is the primary client. Our primary client is a browser, which *needs* a real HTTP server. So
the zero-port mode may only ever apply to the TUI — which means it may be complexity for a
secondary client. Worth deciding before implementing.

**What happens when the daemon dies mid-run?** Orphaned child processes, half-written
worktrees, notes stuck in `running` forever. Needs a reconciliation pass on startup: scan for
live PIDs, mark the rest failed, and say so honestly rather than leaving a lying board.

## Business / policy

**Does wrapping Claude Code's subscription auth violate Anthropic's terms?** Reported yes as of
~Feb 2026; unverified against primary source. This needs a real answer before the "use your
existing subscription" pitch appears anywhere public. See `05-agent-auth.md`.

**What stops t3code — or herdr — from adding columns?** Honestly: nothing, if the board is all
we have. The defensibility has to be in the execution model — parallel isolated worktrees with a
real review flow — which is genuinely harder to retrofit onto a chat-shaped architecture. That's
the bet, and it's a bet, not a certainty.

Sharpened since herdr: the one thing neither can retrofit cheaply is **handing a note to
another person's machine**, because a terminal pane is one machine, one user, and forgets when
it closes. Our append-only log is the substrate for that. Still a bet — and untested until a
note actually moves between two laptops.

**Is there a business here at all, if we don't sell inference?** We have no margin on tokens by
design. That leaves a paid tier for remote access, teams, or hosted relays — all of which are
M4+ features. Worth being clear-eyed that the free local product has no revenue path attached.

The sketch, such as it is, lives in [`11-going-multiplayer.md`](11-going-multiplayer.md). One
property worth protecting deliberately: because agents run on the user's machine with the user's
logins, a hosted tier stores and relays events but never runs inference, never pays for compute,
and never holds a provider key. Per-seat revenue against near-zero marginal cost. It would be
easy to trade that away later for a "run it in our cloud" feature that sounds convenient.

Open and unanswered: what enterprise actually pays for if the log rides on a private git repo,
since repo permissions then answer most of RBAC for free.
